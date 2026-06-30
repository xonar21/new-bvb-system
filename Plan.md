# Plan: Import loaduri MCC/JDA în noul sistem și afișare în sheet

## Obiectiv
Aducem loadurile din portalul MCC/JDA (același flux ca `MccShipmentCommand` din Laravel)
direct în noul sistem Go, le stocăm în Postgres-ul nou și le afișăm ca **rânduri în foaia
principală** (Fortune Sheet), actualizate **automat la interval**.

## Decizii confirmate
1. **Sursă date:** port al scraperului în Go (login JDA + scraping reimplementat în noul backend).
2. **Afișare:** rânduri în foaia principală (același Fortune Sheet pe care îl editează userul).
3. **Sincronizare:** automat la interval (goroutine + ticker) + buton manual „Sync MCC".

---

## Analiza sursei (din Laravel)
Lanțul actual: `php artisan mcc:scrape-shipments` → `scripts/mcc-shipment.py` → upsert în
tabela `mcc_shipments`.

Fluxul real (confirmat din request-ul de login observat în browser): 3 request-uri pe
`abus-tms-pr1.jdadelivers.com`:
1. `GET /tm/framework/Frame.jsp` — inițializează sesiunea. Setează cookies necesare:
   `JSESSIONID`, `tmsprd...`, `testcookie` (+ `__cf_bm` de la Cloudflare). Cookie jar-ul
   trebuie să le păstreze pe toate pentru request-urile următoare.
2. `POST /tm/admin/LoginViewController.jsp` (content-type `application/x-www-form-urlencoded`)
   cu body-ul:
   - `ControllerAction=Login`
   - `newPassword=` (gol)
   - `loginPassword=<token codat pipe-separated>` — **NU parola în clar!**
   - `loginUser=BVBM`
   - `dspLoginPassword=******************` (doar mască afișată, irelevant)
   Headere importante: `Origin` + `Referer=https://abus-tms-pr1.jdadelivers.com/tm/admin/LoginView.jsp`.
   **Succes = HTTP 302 Found** (redirect) — în Go nu urmări automat redirect-ul fără să
   păstrezi cookie-urile; verifică statusul 302 ca semn de login reușit.
3. `GET /tm/entry/LTR_LoadListController.gsm?ControllerAction=Display&IsNavPad=true&NavPadContextID=1422331`
   — întoarce HTML-ul cu tabela `id=LoadTenderListFormSEARCH_RESULTSTableID`.

Scraping: extrage headerele din `<tr class="tableColumnHeadings">`, rândurile din
`tableRow0/tableRow1`, cu `RowKey` din input-ul checkbox. Rezultat: `list[dict]`.

### ⚠️ Fragilități de reținut la port
- **`loginPassword` e un token codat**, nu parola în clar (`VolkSwagen^^...`). Portul Go
  trebuie să trimită **exact același token** SAU să descoperim cum îl generează JS-ul JDA.
  Parola în clar singură NU e suficientă.
- **Tokenul SE ROTEȘTE** — confirmat: ultimul segment s-a schimbat
  (`...|1991130|2853522|` → `...|1991130|2034342|`). De aceea tokenul **NU** se hardcodează
  în cod, ci stă în `MCC_LOGIN_TOKEN` (env) și trebuie reîmprospătat când JDA îl schimbă.
  Sync-ul trebuie să detecteze login eșuat (nu mai primește 302 / tabela lipsește) și să
  emită o eroare clară (`mcc.error` pe WS + log), nu să cadă silențios.
- **`NavPadContextID=1422331`** e hardcodat — se poate schimba; de pus în config.
- Site-ul poate cere CSRF/viewstate ascuns → de verificat la implementare.
- `time.sleep(3)` între request-uri → JDA are nevoie de delay; păstrăm în Go.

### Maparea câmpurilor (din comandă, sursa de adevăr)
| Câmp JSON scrape | Coloană DB | Tip |
|---|---|---|
| `RowKey` | `row_key` | text |
| `Load ID` | `load_id` | text |
| `Load Tracking Number` | `load_tracking_number` | text (cheie logică) |
| `Response Required By Date (MM/DD/YYYY HH:MM)` | `response_required_by_date` | text |
| `Total Distance (MILES)` | `total_distance_miles` | numeric |
| `Stops in Transit` | `stops_in_transit` | int |
| `Service` | `service` | text |
| `Trailer Equipment Type` | `trailer_equipment_type` | text |
| `Total Cost - User Currency (USD)` | `total_cost_usd` | numeric |
| `Total Pieces` / `Total Pallets` | `total_pieces` / `total_pallets` | int |
| `Weight (LB)` / `Volume (CU. FT)` | `weight_lb` / `volume_cuft` | numeric |
| `Origin Address` / `Destination Address` | `origin_address` / `destination_address` | text |
| `Start Date/Time (MM/DD/YYYY HH:MM)` / `End ...` | `start_datetime` / `end_datetime` | text |
| `Commodity` | `commodity` | text |
| `Tender Request ID` | `tender_request_id` | text |

**Câmpuri manuale (moștenite, NU vin din scrape):** `rate`, `rate_interval`, `comments`,
`user_id`, `is_hot`, `order_number`, `font_size`, `is_bold`, `status_user`, `is_lock`.

---

## Arhitectura propusă (în `backend/internal/mcc/`)
Modelăm pachetul după `internal/sheets/` (sync existent), structură nouă:

```
backend/internal/mcc/
├── client.go    # Login JDA (3 request-uri, cookie jar, headers, delay) → HTML
├── scraper.go   # Parse HTML tabel → []RawMccShipment (echivalent BeautifulSoup în Go: goquery)
├── model.go     # RawMccShipment + MccShipment (struct DB)
├── repository.go# Upsert versionat în mcc_shipments + read „curent per tracking number"
├── sync.go      # MccSync: orchestrator (scrape → normalize → upsert → merge în sheet)
└── handler.go   # POST /api/mcc/sync (admin) — trigger manual
```

Dependență Go nouă: `github.com/PuerkitoBio/goquery` (parsing HTML, echivalent BeautifulSoup).

### Wiring în `cmd/server/main.go` (cron-ul stă AICI, în new-bvb-system — NU în Laravel)
- Inițializează `mccSync` cu config (URL, user, token, NavPadContextID, interval).
- **Cron = goroutine cu `ticker`** (interval din env, ex. `MCC_SYNC_INTERVAL=10m`), plus
  rulare la start — exact modelul sync-ului Google existent (`sheetSync` în main.go).
  Laravel-ul NU se mai folosește pentru scraping MCC în acest scenariu.
- Înregistrează `POST /api/mcc/sync` cu `auth.RequireRoles("admin","root")` (trigger manual).
- Callbacks de broadcast WS (`mcc.synced` / `mcc.error`) ca la sync-ul Google existent.

### Config nou (`internal/config/config.go` + `.env`)
```
MCC_ENABLED=true
MCC_BASE_URL=https://abus-tms-pr1.jdadelivers.com
MCC_LOGIN_USER=BVBM
MCC_LOGIN_TOKEN=<token codat din scriptul Python>   # NU în git, doar .env
MCC_NAVPAD_CONTEXT_ID=1422331
MCC_SYNC_INTERVAL=10m
```
> Securitate: credențialele NU se hardcodează în cod și NU se comit. `.env` e deja în .gitignore.

---

## Schema DB nouă (`internal/db/migrations.go`)
Tabel `mcc_shipments` în Postgres-ul nou (echivalent migrației Laravel), versionat pe
`created_at` per `load_tracking_number` (păstrăm istoricul ca în Laravel):
- coloane scrape (vezi tabelul de mapare) + coloane manuale + `is_mcc bool default true`,
  `is_lock bool default false`, `created_at/updated_at`.
- index pe `load_tracking_number`.

---

## Logica de sync (replică `MccShipmentCommand`, în Go)
Pentru fiecare shipment scrape-uit (cheie = `load_tracking_number`):
1. Normalizează câmpurile numerice (același normalizer: int dacă e întreg, altfel 3 zecimale trim).
2. Caută ultimul rând cu același tracking number (`ORDER BY created_at DESC LIMIT 1`).
3. Dacă `last.is_lock == true` → **skip** (nu atinge).
4. Detectează schimbarea zilei de pickup (`start_datetime`, comparație doar pe `Y-m-d`).
5. Compară datele normalizate cu ultimul rând (diff). Dacă e nou SAU s-a schimbat ceva:
   - **Moștenește** câmpurile manuale din `last` (rate, comments, user_id, is_hot,
     order_number, font_size, is_bold).
   - `status_user`: moștenit DOAR dacă ziua de pickup nu s-a schimbat; altfel `NULL`.
   - Inserează rând nou (versionare).

---

## Afișare în foaia principală (partea sensibilă)
Foaia principală e blob-ul `sheet_documents` editat liber de user (`useSheetDoc`), salvat
integral. **Foaia/tab-ul țintă din workbook se numește „AB Loads"** — merge-ul MCC scrie
rânduri DOAR în acest sheet (după `name === "AB Loads"`), nu în alte foi. Injectarea de
rânduri MCC trebuie să **NU clobbereze** editările manuale.

### Strategie de merge (read-modify-write controlat)
1. **Identitate rând:** rezervăm o coloană-cheie (ex. coloana cu `load_tracking_number`) ca
   ancoră stabilă pentru a regăsi rândurile MCC la fiecare sync.
2. La sync, backend-ul: citește blob-ul curent → localizează foaia „AB Loads" în workbook →
   identifică în ea rândurile „deținute de MCC"
   (după prezența tracking number-ului în coloana-ancoră) → **doar pe acele rânduri**:
   - actualizează celulele din coloanele *scrape* (origine, destinație, date, commodity, etc.)
   - **nu atinge** coloanele manuale (rate, comments, status etc.) — le lasă cum le-a pus userul
   - rândurile MCC noi se adaugă la final (sau într-o zonă dedicată)
3. Rândurile non-MCC (scrise manual de user) rămân **neatinse**.
4. Respectă `is_lock`: un rând MCC blocat nu se actualizează.
5. Scrie blob-ul înapoi, creează o versiune (`reason='mcc_sync'`) și broadcast WS
   (`load.updated` / `mcc.synced`) ca să se reflecte live.
6. Folosește diff-ul semantic existent (`diffCells`) ca să NU creeze versiune dacă nimic
   nu s-a schimbat (consistent cu refactoringul anterior).

> ⚠️ **Risc principal:** merge automat peste un blob editat manual = potențial de conflict
> (race cu salvarea debounced a userului). Mitigare: merge-ul atinge DOAR celulele din
> coloanele scrape ale rândurilor MCC, sub un lock scurt; nu rescrie niciodată tot blob-ul.
> Dacă apar conflicte în practică, alternativa mai sigură e o foaie/tab „MCC" separată.

### Mapare coloane sheet (de stabilit cu userul la implementare)
Convenție propusă (ajustabilă): tracking number în col. ancoră, apoi origin, destination,
start/end datetime, commodity, distance, cost — coloanele manuale (rate, comments, status)
rămân editabile de user.

---

## Pași de implementare (ordine)
1. `go get github.com/PuerkitoBio/goquery`.
2. Migrare DB: tabel `mcc_shipments` în noul Postgres.
3. `internal/mcc/client.go` — port fidel al celor 3 request-uri JDA (cookie jar, headers, delay).
4. `internal/mcc/scraper.go` — parsing tabel cu goquery (echivalent `scrape_load_table`).
5. `internal/mcc/model.go` + `repository.go` — struct + upsert versionat + read curent.
6. `internal/mcc/sync.go` — orchestrare + logica de moștenire (replică comanda).
7. Merge în sheet — funcție în `sheetdoc` sau `mcc` care face read-modify-write pe blob.
8. `handler.go` + rută `POST /api/mcc/sync` (admin) + ticker în `main.go`.
9. Config nou + `.env.example`.
10. Frontend: buton „Sync MCC" în sidebar (lângă „Sync Now"), vizibil doar admin/root.

---

## Riscuri & mitigări
- **Token login fragil:** dacă JDA rotește tokenul, login-ul pică → log clar + alertă WS
  (`mcc.error`), nu blochează aplicația.
- **Schimbare structură HTML JDA:** parsing defensiv, eroare explicită dacă tabelul lipsește.
- **Conflict cu editarea manuală:** merge doar pe celule scrape ale rândurilor MCC (vezi mai sus).
- **Past-dated:** filtrare opțională ca la sync-ul Google (de confirmat dacă MCC vrea asta).

## Testare
1. Rulează manual `POST /api/mcc/sync` → verifică `mcc_shipments` populat corect.
2. Verifică rândurile MCC apar în sheet, în coloanele corecte.
3. Editează manual o coloană (rate/comments) pe un rând MCC → re-sync → editarea rămâne.
4. Blochează un rând (`is_lock`) → re-sync → rândul nu se schimbă.
5. Schimbă ziua de pickup în sursă → `status_user` devine NULL pe rândul nou.

## Build
```bash
docker compose up -d --build backend frontend
```
