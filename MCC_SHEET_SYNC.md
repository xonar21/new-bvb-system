# MCC Sheet Sync — documentație tehnică

Cum aduce `new-bvb-system` loadurile MCC/BudExchange din API-ul `bvbconnect.com` și le
**scrie direct ca rânduri în foaia „AB Loads"** (Fortune Sheet), la interval de 5 minute.

> Context de ce am ales API în loc de scraping JDA: vezi [Plan.md](Plan.md).

---

## 1. Arhitectură de ansamblu

```
        ┌──────────── new-bvb-system (backend Go) ────────────┐
        │                                                     │
 cron   │  1. sheetapi.Client.FetchAll()                      │
 5 min ─┼─►   GET bvbconnect.com/api/v1/sheet/loads (paginat) │
        │       (cu paginație: 20/pagină, ~684 loaduri)       │
        │         │                                           │
        │         ▼                                           │
        │  2. MERGE DIRECT în foaia „AB Loads"                │
        │         │  (sheet_documents blob, celldata sparse)  │
        │         │  - upsert rând după gateCode (col F)       │
        │         │  - scrie DOAR coloanele API (A,B,C,D,F,H) │
        │         │  - NU atinge coloanele manuale (E, G)      │
        │         │  - NU șterge rânduri (doar le marchează)  │
        │         ▼                                           │
        │  3. versiune sheet (reason='mcc_sync') + WS broadcast│
        └─────────────────────────────────────────────────────┘
                              │
                              ▼  WebSocket "sheet.updated"
                     browserele deschise refac foaia live
```

**Principii:**
- **NU tabel intermediar** `mcc_loads`. Foaia „AB Loads" = singurul loc cu date.
- Foaia rămâne editabilă de useri; cron-ul atinge **doar** celulele pe care le „deține" (A,B,C,D,F,H).
- Cron scrie atunci când API se schimbă; versioning automat (reason='mcc_sync').

---

## 2. API Client — `internal/sheetapi/client.go`

Apelează endpoint-ul `bvbconnect.com/api/v1/sheet/loads`, cu paginație.

**Autentificare**: header `X-Api-Key: <SHEET_API_KEY>` (din `.env` sau `docker-compose.yml`)

**Paginare**: răspunsul are `total`, `page`, `limit`; API-ul întoarce ~684 loaduri,
default `limit=20` → parcurgem paginile până acoperim `total`.

```go
type SheetLoad struct {
    GateCode     string    `json:"gateCode"`
    PickupDate   time.Time `json:"pickupDate"`
    PickupTime   string    `json:"pickupTime"`
    OriginCity   string    `json:"originCity"`
    OriginState  string    `json:"originState"`
    DeliveryDate time.Time `json:"deliveryDate"`
    DeliveryTime string    `json:"deliveryTime"`
    DestCity     string    `json:"destCity"`
    DestState    string    `json:"destState"`
    Rate         int       `json:"rate"`
    IsHot        bool      `json:"isHot"`
    IsMCC        bool      `json:"isMCC"`
    MccType      string    `json:"mccType"`
}

type listResponse struct {
    Data  []SheetLoad `json:"data"`
    Total int         `json:"total"`
    Page  int         `json:"page"`
    Limit int         `json:"limit"`
}

// FetchAll parcurge toate paginile și întoarce toate loadurile.
func (c *Client) FetchAll(ctx context.Context) ([]SheetLoad, error) {
    var all []SheetLoad
    page := 1
    limit := 20
    for {
        url := fmt.Sprintf("%s/api/v1/sheet/loads?page=%d&limit=%d", c.baseURL, page, limit)
        req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
        req.Header.Set("X-Api-Key", c.apiKey)
        resp, err := c.http.Do(req)
        if err != nil { return nil, err }
        var lr listResponse
        if err := json.NewDecoder(resp.Body).Decode(&lr); err != nil {
            resp.Body.Close(); return nil, err
        }
        resp.Body.Close()
        all = append(all, lr.Data...)
        if len(all) >= lr.Total || len(lr.Data) == 0 { break }
        page++
    }
    return all, nil
}
```

> Notă 503: dacă serverul bvbconnect.com nu are `SHEET_API_KEY` setat, întoarce
> `503 {"error":"sheet integration not configured"}`. Sync-ul trebuie să trateze non-200
> ca eroare clară (logată, WS `mcc.error`), nu să pice silențios.

---

## 3. Cum se scrie în foaia „AB Loads" (MIEZUL)

### 3.1. Structura workbook-ului

Foaia trăiește în tabelul `sheet_documents`, un **singur rând global** (`id = 1`), coloana
`data` = JSON cu **array de foi** (Fortune Sheet `Sheet[]`). Fiecare foaie:

```json
{
  "name": "AB Loads",
  "id": "sheet-1",
  "celldata": [
    { "r": 0, "c": 0, "v": { "v": "7/12/2026", "m": "7/12/2026" } },
    { "r": 1, "c": 5, "v": { "v": "31073812", "m": "31073812" } }
  ]
}
```

**Formatul unei celule** (`celldata[i]`):
- `r` = index rând (0-based), `c` = index coloană (0-based)
- `v` = obiectul valorii:
  - `v.v` = valoarea brută (ce se stochează)
  - `v.m` = textul afișat (monitor) — de regulă egal cu `v.v` pentru text
  - opțional stil: `bg` (fundal), `fc` (culoare font), `bl` (1=bold)…

> `celldata` e **sparse**: apar doar celulele care au conținut.
> **Rândul 0 = banner de status** (înghețat). Datele încep de la r >= 1.

### 3.2. Maparea coloanelor (layout REAL)

Foaia folosește layout-ul din scriptul existent (`C:\Work\script`).

| Col | c | Conținut | Scrie cron? | Sursă din `SheetLoad` |
|-----|---|----------|:-----------:|------------------------|
| A | 0 | `7/12/2026` | ✅ | `PickupDate` → `M/D/YYYY` |
| B | 1 | `DRY` | ✅ | constantă „DRY" (MCC = mereu DRY) |
| C | 2 | `JACKSONVILLE, FL 10AM` | ✅ | `OriginCity, OriginState + " " + PickupTime` |
| D | 3 | `CHARLOTTE, NC 07/13 6AM` | ✅ | `DestCity, DestState + " " + DeliveryDate(MM/DD) + " " + DeliveryTime` |
| **E** | 4 | note manuale | ❌ **NICIODATĂ** | — (păstrată valoare + stil) |
| F | 5 | `31073812` | ✅ | `GateCode` — **coloana-ancoră** pentru upsert |
| **G** | 6 | **rate** | ❌ **NICIODATĂ** | — (manuală, ca în script) |
| H | 7 | `HOT` | ✅ (doar când `isHot`) | text „HOT", font roșu |

> **Coloane pe care cron-ul le scrie:** A, B, C, D, F, H (dacă isHot).
> **Coloane INTANGIBILE:** E, G — nu se scrie niciodată acolo.

### 3.3. Algoritmul de merge (upsert după gateCode)

```
1. Citește sheet_documents (id=1) → deserializează []Sheet.
2. Găsește foaia țintă: name == "AB Loads" (case-insensitive).
3. Construiește indexul rândurilor existente:
   - parcurge celdata (r >= 1); pentru fiecare celulă cu c==5 (col F) →
     map[normGate(gateCode)] = r
   - normGate = strip zerouri la început (0031073812 → 31073812).
   - reține maxRow = cel mai mare r folosit.
4. Pentru fiecare load din API:
     cells := cellsForLoad(load)
     if r, ok := index[normGate(load.GateCode)]; ok {
         // UPDATE: scrie coloanele deținute (0,1,2,3,5,[7]) pe rândul r.
         for c, val := range cells { setCell(sheet, r, c, val) }
     } else {
         // INSERT: rând nou la maxRow+1, apoi maxRow++
         r = maxRow + 1; maxRow++
         for c, val := range cells { setCell(sheet, r, c, val) }
     }
5. Serializează []Sheet înapoi → salvează (sheetdoc.Repository.CreateVersion).
```

Helper de formatare:
```go
func cellsForLoad(l SheetLoad) map[int]string {
    cells := map[int]string{
        0: l.PickupDate.Format("1/2/2006"),
        1: "DRY",
        2: strings.TrimSpace(fmt.Sprintf("%s, %s %s", l.OriginCity, l.OriginState, l.PickupTime)),
        3: strings.TrimSpace(fmt.Sprintf("%s, %s %s %s",
             l.DestCity, l.DestState, l.DeliveryDate.Format("01/02"), l.DeliveryTime)),
        5: l.GateCode,
    }
    if l.IsHot {
        cells[7] = "HOT"  // col H
    }
    return cells
}
```

### 3.4. Salvare + istoric + live update

Refolosește infrastructura existentă:
- Salvează prin `sheetdoc.Repository.CreateVersion(...)` cu `reason = "mcc_sync"` și user „mcc-bot".
- Diff-ul semantic previne versiuni goale (dacă sync nu schimbă nicio celulă, nu se creează versiune).
- După salvare, broadcast WS `sheet.updated` prin `wsHub.Broadcast(...)` ca browserele deschise să refacă foaia.

---

## 4. Cron-ul — `internal/sheetapi/sync.go` + wiring în `cmd/server/main.go`

Model identic cu `sheetSync` existent (goroutine + `ticker`, rulează și la start):

```go
// în main.go, după inițializarea celorlalte:
if cfg.SheetAPIEnabled && cfg.SheetAPIKey != "" {
    apiClient := sheetapi.NewClient(cfg.SheetAPIBaseURL, cfg.SheetAPIKey)
    apiSync := sheetapi.NewSync(apiClient, sheetDocRepo, wsHub)

    go func() {
        ticker := time.NewTicker(cfg.SheetAPISyncInterval) // ex. 5m
        defer ticker.Stop()
        if err := apiSync.Run(context.Background()); err != nil {
            log.Println("Initial MCC API sync error:", err)
        }
        for range ticker.C {
            if err := apiSync.Run(context.Background()); err != nil {
                log.Println("MCC API sync error:", err)
            }
        }
    }()

    // trigger manual (admin): POST /api/mcc/sync
    api.Post("/mcc/sync", authMW, auth.RequireRoles("admin", "root"),
        sheetapi.NewHandler(apiSync).TriggerSync)
}
```

`Sync.Run(ctx)` orchestrează:
1. `FetchAll` din API.
2. Merge în foaia „AB Loads".
3. Salvează versiune + broadcast WS.

---

## 5. Config — `internal/config/config.go` + `.env`

```env
SHEET_API_ENABLED=true
SHEET_API_BASE_URL=https://bvbconnect.com
SHEET_API_KEY=53092aeda6867d9c521b80a6625495779dc1a898800fd1909854858ca1c8987c
SHEET_API_SYNC_INTERVAL_MINUTES=5
```

---

## 6. Testare end-to-end

1. **API viu:** `curl -H "X-Api-Key: $SHEET_API_KEY" https://bvbconnect.com/api/v1/sheet/loads?limit=5`
2. **Sync manual:** `POST /api/mcc/sync` (admin) → verifică rânduri noi pe „AB Loads".
3. **Preserve manual:** scrie ceva pe col E → re-sync → col E rămâne.
4. **Istoric:** modificarea apare în „Loguri & istoric" ca versiune `reason='mcc_sync'`.

---

## 7. Rezumat decizii

- **Țintă:** merge direct în „AB Loads" (fără tabel intermediar `mcc_loads`).
- **Coloane scrise:** A, B, C, D, F, H (dacă isHot).
- **Coloane INTANGIBILE:** E (note), G (rate — manuală).
- **Coloana B:** constantă „DRY" (MCC = mereu DRY).
- **Lock Q/Z:** nu în această fază.
- **Reguli vizuale** (colorare, bold) din scriptul existent — adăugate incremental.
