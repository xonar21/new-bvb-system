# Plan: Import loaduri MCC/BudExchange prin Sheet API și afișare în sheet

## Context — de ce s-a schimbat abordarea

Vechea abordare (scraping direct JDA/`jdadelivers.com` din noul backend Go) a fost
**abandonată** și ștearsă. Motive:
- Tokenul de login JDA se rotește și e fragil (login pică silențios).
- HTML-ul JDA e greu de parsat (tabel gol în răspuns, compresie Brotli, sesiune expiră).
- Datele MCC/BudExchange există deja normalizate în backend-ul `bvbconnect.com` (proiectul
  Laravel/Go vechi), care are deja tot pipeline-ul de import și enrichment.

**Noua abordare:** `new-bvb-system` devine **client al unui API dedicat** expus de
`bvbconnect.com`, cu cheie proprie (`SHEET_API_KEY`). Citim loadurile MCC/BUDEXCHANGE prin
API, le salvăm în Postgres-ul nostru și le afișăm ca rânduri în foaia „AB Loads". Opțional,
scriem înapoi numărul KDA prin același API.

> Referință completă a API-ului: `new-sheet-api.md` (primit de la echipa bvbconnect.com).

---

## Contractul Sheet API (pe `bvbconnect.com`)

**Auth:** header `X-Api-Key: <SHEET_API_KEY>`. Cheia funcționează DOAR pe `/api/v1/sheet/*`.

### `GET /api/v1/sheet/loads`
Întoarce loadurile cu `source IN (MCC, BUDEXCHANGE)` (filtru hardcodat server-side).
Răspuns = `AdminLoadListResponse` — include `gateCode` și `kdaLoadNumber`.

Query params suportate: `status`, `origin`, `origin_state`, `destination`, `dest_state`,
`equipment`, `load_type`, `capacity`, `commodity`, `gate_code`, `pickup_from`, `pickup_to`,
`weight_min`, `weight_max`, `sort`, `page`, `limit`, `cursor`.

```bash
curl -H "X-Api-Key: $SHEET_API_KEY" \
  "https://bvbconnect.com/api/v1/sheet/loads?status=ACTIVE&limit=50"
```

Răspuns:
```json
{ "data": [ { "id": 445, "gateCode": "TESTGATE1", "source": "MCC",
             "kdaLoadNumber": "", "originCity": "Columbus", "...": "..." } ],
  "total": 1, "page": 1, "limit": 50 }
```

### `POST /api/v1/sheet/loads/kda-number`
Setează numărul KDA pentru loadul cu un anumit gate code (echivalent cu ce face azi
`KDAListEnricherConnector` prin pull din Google Sheet).

```bash
curl -X POST -H "X-Api-Key: $SHEET_API_KEY" -H "Content-Type: application/json" \
  -d '{"gateCode":"TESTGATE1","kdaLoadNumber":"KDA-999"}' \
  https://bvbconnect.com/api/v1/sheet/loads/kda-number
```
- `200 {"updated": true}` — găsit și actualizat.
- `404 {"error": "load not found for gate code"}` — gate code inexistent.
- `400` — lipsește `gateCode` sau `kdaLoadNumber`.

---

## ⚠️ Blocant curent (de rezolvat ÎNTÂI, pe serverul bvbconnect.com)

`GET /api/v1/sheet/loads` întoarce acum **`503 {"error":"sheet integration not configured"}`**.
Conform contractului, asta înseamnă că `SHEET_API_KEY` **nu e setat pe serverul
`bvbconnect.com`** (fail-closed by design).

Cheia din `new-bvb-system/.env` e doar partea de **client** — trebuie setată aceeași valoare
și pe serverul bvbconnect.com:

```bash
# în .env-ul de pe bvbconnect.com:
SHEET_API_KEY=53092aeda6867d9c521b80a6625495779dc1a898800fd1909854858ca1c8987c
# apoi restart backend-ul acela (docker compose restart backend / systemctl restart ...)
```

Verificare după setare:
```bash
curl -i -H "X-Api-Key: 53092aeda6867d9c521b80a6625495779dc1a898800fd1909854858ca1c8987c" \
  "https://bvbconnect.com/api/v1/sheet/loads?limit=5"
# așteptat: 200 + JSON cu data[]
```

Până când acest curl întoarce 200, restul (Fazele 1–4) nu are ce importa.

---

## Config nou în `new-bvb-system` (`internal/config/config.go` + `.env`)

```
SHEET_API_ENABLED=true
SHEET_API_BASE_URL=https://bvbconnect.com
SHEET_API_KEY=53092aeda6867d9c521b80a6625495779dc1a898800fd1909854858ca1c8987c   # doar .env, NU în git
SHEET_API_SYNC_INTERVAL_MINUTES=5
```
> `.env` e deja în `.gitignore`. În `docker-compose.yml` se adaugă aceleași chei la
> serviciul `backend` (ca la `GOOGLE_*`).

---

## Ce se construiește în `new-bvb-system` (faze)

### Faza 0 — Prerechizit (nu e cod aici)
Setează `SHEET_API_KEY` pe bvbconnect.com și confirmă cu curl că `GET .../sheet/loads` → 200.

### Faza 1 — Client API (citire)
Pachet nou `backend/internal/sheetapi/`:
- `client.go` — `Client` cu `baseURL` + `apiKey`; metodă `FetchLoads(filters) ([]SheetLoad, error)`
  care face `GET /api/v1/sheet/loads` cu headerul `X-Api-Key`, paginează după `total`/`limit`,
  deserializează `AdminLoadListResponse`.
- `model.go` — struct `SheetLoad` cu câmpurile din `AdminLoadResponse` care ne interesează
  (minim: `id`, `gateCode`, `source`, `kdaLoadNumber`, origin/destination, date, commodity,
  weight, rate etc. — de mapat la nevoie).

Test rapid Faza 1: log cu numărul de loaduri primite la un `POST /api/sheetapi/sync` manual.

### Faza 2 — Persistență în DB
Salvăm loadurile în tabelul existent `loads` (are deja `gate_code_col6` UNIQUE), refolosind
pattern-ul din `internal/sheets/sync.go` (upsert cu `ON CONFLICT (gate_code_col6)` și
protecția `is_lock` — celulele blocate nu se suprascriu). `source` MCC/BUDEXCHANGE → marcăm
`is_mcc = true`.
> Nu creăm tabel nou `mcc_shipments` (a fost șters). Sursa de adevăr rămâne `loads`.

### Faza 3 — Merge în foaia „AB Loads" + sync automat
- Merge în blob-ul `sheet_documents` DOAR pe foaia cu `name === "AB Loads"`, doar pe celulele
  din coloanele care vin din API; coloanele manuale (rate, comments, status) rămân neatinse
  (același principiu ca la merge-ul descris anterior, cu `diffCells` ca să nu creăm versiuni
  goale).
- Sync automat: goroutine cu `ticker` în `cmd/server/main.go` (interval din
  `SHEET_API_SYNC_INTERVAL_MINUTES`, rulează și la start) — model identic cu `sheetSync`.
- Trigger manual: `POST /api/sheetapi/sync` cu `auth.RequireRoles("admin","root")`.
- Broadcast WS: `sheetapi.synced` / `sheetapi.error` (ca la sync-ul Google existent).

### Faza 4 — (Opțional) Push KDA number înapoi
Când userul completează numărul KDA într-un rând din „AB Loads", trimitem
`POST /api/v1/sheet/loads/kda-number` cu `{gateCode, kdaLoadNumber}` prin `sheetapi.Client`.
> De decis cu userul dacă vrem push automat sau doar la buton.

---

## Unde se scot lucrurile vechi (MCC scraper) — DEJA FĂCUT

Șters în această sesiune:
- Folderul `backend/internal/mcc/` (client/scraper/sync/handler/model/repository).
- Blocul de init MCC + endpointul `POST /api/mcc/sync` din `cmd/server/main.go`.
- Câmpurile `MCC*` din `internal/config/config.go`.
- Tabelul `mcc_shipments` din `internal/db/migrations.go`.
- Bypass-ul `/api/mcc/sync` din `internal/allowedips/middleware.go`.
- Variabilele `MCC_*` din `.env` și `docker-compose.yml`.
- Dependența `goquery` (curățată de `go mod tidy` la următorul build).

> Coloanele `is_mcc` / `note_mcc` din tabelul `loads` și funcția `DetectMCC` din
> `internal/loads/logic.go` sunt cod ORIGINAL (sync-ul Google) — se PĂSTREAZĂ.

---

## Testare end-to-end (după Faza 0)
1. `curl` cu cheia → `GET /api/v1/sheet/loads` întoarce 200 + `data[]`.
2. `POST /api/sheetapi/sync` (admin) → log cu N loaduri, apoi verifică `loads` în Postgres.
3. Loadurile MCC/BUDEXCHANGE apar ca rânduri în foaia „AB Loads".
4. Editează manual o coloană (rate/comments) pe un rând → re-sync → editarea rămâne.
5. Blochează un rând (`is_lock`) → re-sync → rândul nu se schimbă.
6. (Faza 4) Completează KDA number → `POST .../kda-number` → `200 {"updated":true}`.

## Build
```bash
docker compose up -d --build backend frontend
# verificare log sync:
docker logs bvb-backend | grep -i sheetapi
```
