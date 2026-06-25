# Sheet colaborativ — persistență, prezență, versiuni & audit

Documentație pentru funcționalitățile adăugate peste dashboard-ul BVB Freight:
control acces pe roluri, prezență în timp real (culori + email per user), salvarea
completă a sheet-ului în baza de date, plus versiuni și jurnal de modificări.

> Sheet-ul vizibil în aplicație este randat de `LuckysheetBoard.tsx` folosind
> biblioteca **@fortune-sheet/react** (un Excel pe canvas). Vechile componente
> `LoadsBoard.tsx` / `LoadCell.tsx` (tabel HTML) au fost **șterse** — erau cod mort.

---

## 1. Roluri și permisiuni (RBAC)

Trei roluri, fiecare cu culoare proprie stocată în baza de date (`users.color`).

| Rol      | Loads (sheet)        | Salvare modificări | Users / IPs | Loguri & istoric | Restaurare versiuni |
|----------|----------------------|--------------------|-------------|------------------|---------------------|
| `admin` / `root` | editare completă | ✅ | ✅ | ✅ (tab + pagină) | ✅ |
| `editor` | editare completă     | ✅ | ❌ | ❌ (ascuns)      | ❌ |
| `viewer` | doar citire          | ❌ | ❌ | ❌               | ❌ |

**Useri seed** (creați automat la pornire — `migrations.go`):

| Email               | Parolă     | Rol    | Culoare   |
|---------------------|------------|--------|-----------|
| admin@bvb.local     | admin123   | admin  | `#2ecc71` (verde) |
| editor@bvb.local    | editor123  | editor | `#4a90d9` (albastru) |
| viewer@bvb.local    | viewer123  | viewer | `#e67e22` (portocaliu) |

Backend: middleware nou `auth.RequireRoles(roles...)` (permite oricare din roluri).

---

## 2. Prezență în timp real (cine lucrează unde)

Când un user dă **click pe o celulă**, ceilalți useri văd acea celulă colorată în
culoarea lui; la **hover** (mouse deasupra, fără click) apare un tooltip cu email-ul.

- Funcționează pe **orice celulă, inclusiv goală** — prezența e urmărită pe
  **coordonate (rând/coloană)**, nu pe `load_id`.
- Nu îți vezi propriul cursor colorat (ca în Google Sheets) — vezi doar pe ceilalți,
  iar propria celulă rămâne liber editabilă.
- Declanșat de hook-ul Fortune Sheet `afterSelectionChange` → mesaj WS `cell.focus`.

Flux: `afterSelectionChange` → `cell.focus {row,col,action}` (WS) → hub → broadcast →
`useWebSocket` → store `focusedCells` → `addPresences()` (marcaj nativ Fortune Sheet)
→ overlay CSS: box colorat (vizual, `pointer-events:none`) + tooltip email la hover.

---

## 3. Persistența completă a sheet-ului

Sincronizarea Google Sheets a fost **oprită** (flag `SYNC_ENABLED`, implicit `false`).
Sheet-ul este acum un **document independent**, salvat integral în baza de date.

- **Ce se salvează:** numele sheet-ului, toate celulele (inclusiv goale), toate
  stilurile (bold/culoare/font), config (lățimi coloane / înălțimi rânduri), merge-uri.
- **Cum:** la fiecare modificare locală se salvează **întreg workbook-ul** (debounced
  ~1.2s) prin `PUT /api/sheet`. La încărcare se restaurează din `GET /api/sheet`.
- **Colaborare live:** modificările se propagă instant între useri prin `sheet.op`
  (Fortune Sheet `applyOp`), independent de salvarea în DB.

---

## 4. Versiuni & jurnal de modificări (audit)

### Versiuni (snapshot complet)
Se creează automat:
- **înainte** și **după** fiecare ștergere (`before_delete` / `after_delete`);
- **periodic** la editare normală (throttling: max o versiune la ~2 min);
- **manual** (`reason: "manual"`) sau la **restaurare** (`restore`).

### Jurnal ștergeri (audit log)
La fiecare ștergere se înregistrează: **cine**, **ce** (rânduri / coloane / celule),
**când**. Detectare pe frontend (`detectDeletion`): op `deleteRowCol`, `remove`, sau
`replace` cu valoare goală.

### Protecție
Fără dialog de confirmare la ștergere — siguranța vine din faptul că **totul este
versionat și recuperabil**, iar adminul poate **restaura** orice versiune anterioară.

### Acces
Doar **admin/root** văd istoricul și pot restaura.

---

## 5. Pagina de loguri (tab separat de browser)

În sidebar, **doar adminul** vede tab-ul **„Loguri & istoric"**. Click pe el deschide
o **pagină separată într-un tab nou de browser** (ruta `#/logs`), ca să poată fi
văzută lângă sheet:

- **Tab „Versiuni"** — lista snapshot-urilor (tip, utilizator, dată) + buton
  **Restaurează** (cu confirmare).
- **Tab „Jurnal ștergeri"** — cine a șters, ce și când.
- Ruta `#/logs` e protejată: non-admin → „Acces interzis"; nelogat → pagina de login.

---

## 6. Schema bazei de date (tabele noi / modificate)

```sql
-- users: coloană nouă pentru culoarea per user
ALTER TABLE users ADD COLUMN color VARCHAR(7) DEFAULT '#4a90d9';

-- documentul curent (un singur rând, id = 1) — starea completă a workbook-ului
CREATE TABLE sheet_documents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Loads',
  data JSONB NOT NULL DEFAULT '{}',          -- Fortune Sheet Sheet[] complet
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_edited_by INT REFERENCES users(id)
);

-- istoricul de versiuni (snapshot-uri complete)
CREATE TABLE sheet_versions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Loads',
  data JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'auto',         -- auto | before_delete | after_delete | manual | restore
  created_by INT REFERENCES users(id),
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- jurnal de ștergeri
CREATE TABLE sheet_audit_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  user_email TEXT,
  action TEXT NOT NULL,                        -- delete_rows | delete_cols | clear_cells | restore
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. API Endpoints

| Metodă | Rută | Acces | Descriere |
|--------|------|-------|-----------|
| GET  | `/api/sheet` | autentificat | Documentul curent (nume + data) |
| PUT  | `/api/sheet` | admin/editor/root | Salvează tot workbook-ul (`reason: auto\|manual`) |
| POST | `/api/sheet/delete-event` | admin/editor/root | Salvează before+after + audit la ștergere |
| GET  | `/api/sheet/versions` | admin/root | Lista versiunilor (fără blob) |
| GET  | `/api/sheet/versions/:id` | admin/root | O versiune completă (cu data) |
| POST | `/api/sheet/versions/:id/restore` | admin/root | Restaurează o versiune |
| GET  | `/api/sheet/audit` | admin/root | Jurnalul de ștergeri |
| WS   | `cell.focus {row,col,action}` | JWT | Prezență pe coordonate |

---

## 8. Fișiere modificate / adăugate

### Backend
- `internal/config/config.go` — flag `SyncEnabled` (`SYNC_ENABLED`, implicit off) + `getEnvBool`
- `cmd/server/main.go` — sync gândit pe `SyncEnabled`; înregistrare rute `sheetdoc`
- `internal/auth/middleware.go` — `RequireRoles(...)`
- `internal/db/migrations.go` — tabele `sheet_documents`, `sheet_versions`, `sheet_audit_log`
- `internal/sheetdoc/` *(pachet nou)* — `model.go`, `repository.go`, `handler.go`
- `internal/ws/messages.go` — `CellFocusPayload`: câmpuri `Row`, `Col`, `Color`
- `internal/ws/hub.go` — `SetFocus` cheie pe user (o prezență per user)
- `internal/ws/client.go` + `internal/users/*` — propagarea culorii userului

### Frontend
- `hooks/useSheetDoc.ts` *(nou)* — load/save sheet, delete-event, versiuni, audit, restore
- `features/LoadsBoard/LuckysheetBoard.tsx` — load/save snapshot, prezență pe coordonate,
  detectare ștergeri, tooltip email la hover
- `features/LoadsBoard/SheetHistory.tsx` *(nou)* — pagina de loguri (versiuni + audit)
- `store/wsStore.ts` — `focusedCells` pe coordonate (cheie pe user)
- `hooks/useWebSocket.ts` — handler `cell.focus` cu row/col
- `types/Load.ts` — `CellFocusPayload` row/col; `User.color`
- `utils/colors.ts` *(nou)* — helperi culori
- `components/Sidebar.tsx` — tab „Loguri & istoric" admin-only → deschide tab nou (`#/logs`)
- `App.tsx` — rută standalone `#/logs`
- *(șterse)* `features/LoadsBoard/LoadsBoard.tsx`, `features/LoadsBoard/LoadCell.tsx`

---

## 9. Cum rulezi & testezi

```powershell
# Dev (hot-reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# Frontend: http://localhost:5173   Backend: http://localhost:3001
```

**Prezență + culori** (2 browsere): login `admin` într-unul, `editor` în incognito;
click pe o celulă într-unul → în celălalt celula e colorată; hover → email.

**Persistență:** scrie/colorează/redenumește sheet-ul → refresh (`Ctrl+Shift+R`) →
totul rămâne.

**Versiuni & audit:** ca admin, șterge un rând → tab nou **„Loguri & istoric"** →
vezi `before_delete`/`after_delete` + cine a șters → **Restaurează**.

**RBAC:** `viewer` nu poate salva (403); `editor` nu vede logurile (403 / tab ascuns).

---

## 10. Note & limitări

- Versiunile se acumulează în `sheet_versions` (fără ștergere automată). Dacă devin
  prea multe, se poate adăuga un prune (păstrare ultimele N).
- La restaurare, tab-ul de loguri se reîncarcă; tab-ul cu sheet-ul deschis trebuie
  reîmprospătat manual pentru a vedea starea restaurată.
- Pentru reaplicarea schemei (tabele noi) pe un volum existent, vezi `CLAUDE.md`
  (secțiunea dev cu `docker compose down --volumes`). La instalare nouă, tabelele
  se creează automat (`CREATE TABLE IF NOT EXISTS`).
