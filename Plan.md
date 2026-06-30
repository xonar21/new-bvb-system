# Plan: Refactoring pagina "Loguri & istoric modificări"

## Problema
Pagina actuală (`frontend/src/features/LoadsBoard/SheetHistory.tsx`) arată aglomerat și
conține multă informație inutilă:
- **2 tabele separate** (Versiuni / Jurnal ștergeri) cu stiluri inline repetate, inconsistente.
- **Listă plată de timestamp-uri** fără grupare — greu de scanat.
- **Coloana "Tip"** e aproape mereu „Automat" → zgomot fără valoare.
- **Coloana "Detalii"** afișează stringuri tehnice monospace (`celule: 5`) — neprietenos.
- **Nu se vede CE s-a schimbat** direct în listă — trebuie deschis modalul de fiecare dată.
- **Panoul lateral** „Cine a modificat" poate fi gol („0 modificări") — inutil.
- **Email plat** în loc de identitate vizuală (deși fiecare user are o culoare în DB).

**Obiectiv:** un singur feed cronologic, curat, ușor de citit, fără informație redundantă.

---

## Concept nou: un singur "Activity Feed" (timeline)
Înlocuim cele 2 tabele cu **o singură listă cronologică de evenimente**, grupată pe zile.
Fiecare eveniment e un card compact cu: ora, identitatea userului (chip colorat + email),
un rezumat uman al acțiunii și butoanele de acțiune.

### Tipuri de evenimente (un singur model unificat)
| Tip | Sursă | Rezumat afișat | Acțiuni |
|-----|-------|----------------|---------|
| Editare | `sheet_versions` (auto/manual) | „a modificat **N celule**" | 👁 Vizualizează · Restaurează |
| Ștergere | `sheet_audit_log` (clear_cells/delete_*) | „a șters **N celule**" | 👁 Înainte / După |
| Restaurare | `sheet_versions` reason=restore | „a restaurat o versiune" | 👁 Vizualizează |

> Editările și ștergerile se contopesc într-un singur flux sortat după `created_at`.
> Cele 2 taburi dispar (sau rămân ca **filtru** opțional: Toate / Editări / Ștergeri).

### Layout card (exemplu vizual)
```
┌──────────────────────────────────────────────────────────────┐
│  Astăzi                                                        │  ← header sticky pe zi
├──────────────────────────────────────────────────────────────┤
│ 10:38  🟦 admin@bvb.local   a șters 12 celule    [👁 Vezi]     │
│ 10:16  🟩 ion@bvb.local     a modificat 5 celule [👁][↺]       │
│ 09:50  🟦 admin@bvb.local   a restaurat o versiune [👁]        │
└──────────────────────────────────────────────────────────────┘
```

---

## Modificări de făcut (toate în `SheetHistory.tsx`, fără backend)

### 1. Unifică datele într-un singur array de evenimente
- După `reload()`, construiește `events: TimelineEvent[]` din `versions` + `audit`:
  ```ts
  type TimelineEvent = {
    id: string            // `v-<id>` sau `a-<id>` (prefix ca să nu se ciocnească)
    kind: 'edit' | 'delete' | 'restore'
    at: string            // created_at
    userEmail: string
    userColor?: string    // din event, vezi pct. 5
    changeCount?: number  // celule modificate / șterse
    raw: SheetVersionMeta | AuditEntry  // pentru handlerele de view
  }
  ```
- Sortează descrescător după `at`.
- **Editări**: pentru fiecare versiune auto/manual, `changeCount` = nr. de `CellChange`
  din `changes` care cad în intervalul (versiunea anterioară, versiunea curentă] — exact
  logica deja existentă din `handleView` (liniile ~211-216), extrasă într-un helper
  `countChangesForVersion(version, index)`.
- **Ștergeri**: `changeCount` din `summarize()`/`details` sau calculat din before/after.

### 2. Grupare pe zile + headere sticky
- Helper `dayLabel(ts)` → „Astăzi" / „Ieri" / `30 iun. 2026`.
- Randează grupuri: header de zi (sticky, gri deschis) + cardurile zilei dedesubt.

### 3. Card de eveniment (înlocuiește rândurile de tabel)
- O singură componentă `<EventRow event={e} ... />`, fără tabel.
- Conține: oră (`HH:mm`), chip user, rezumat uman, butoane acțiune la dreapta.
- **Elimină** coloanele „Tip" și „Detalii" — informația lor intră în rezumatul uman
  (`a modificat N celule` / `a șters N celule` / `a restaurat o versiune`).
- Pictogramă mică per tip: ✏️ editare, 🗑 ștergere, ↺ restaurare.

### 4. Ascunde zgomotul
- **Nu afișa evenimente cu `changeCount === 0`** (backend deja nu mai creează versiuni
  goale, dar lista trebuie să fie defensivă).
- Snapshot-urile `before_delete` / `after_delete` rămân ascunse din feed (sunt detaliu
  intern al unei ștergeri) — păstrează filtrul existent din `reload()`.

### 5. Identitate vizuală: chip colorat per user
- Adaugă un mic „chip" rotund cu inițiala + culoarea userului lângă email.
- Culoarea: dacă API-ul nu o întoarce în versiuni/audit, folosește un **hash determinist**
  pe email → culoare (helper `colorForEmail(email)`), ca să fie consistentă vizual.
  (Opțional, dacă vrem culoarea reală din `users.color`, e nevoie de o mică extindere
  backend — marcat ca îmbunătățire ulterioară, nu blocant.)

### 6. Curățenie de cod / design tokens
- Extrage stilurile inline repetate în constante la nivel de modul:
  `const tokens = { border, radius, shadow, muted, ... }` și mici obiecte de stil
  (`cardStyle`, `dayHeaderStyle`, `btnGhost`, `btnPrimary`).
- Reduce duplicarea dintre cele 2 modale păstrând un singur `<PreviewModal>` reutilizabil
  pentru header + buton Închide (conținutul rămâne specific).

### 7. Modalele (păstrate, curățate)
- **Modal versiune**: panoul lateral „Cine a modificat" se afișează **doar dacă** există
  `cellChanges.length > 0`; altfel modalul e doar preview full-width.
- **Modal ștergere**: rămâne cu toggle Înainte/După și roșu pe celulele șterse
  (fix-ul `!aMap.has(k)` deja aplicat). Header-ul afișează `N celule afectate`.

---

## Ce NU schimbăm
- Backend / DB / API — neatins (datele există deja: versions, audit, cell changes).
- Logica de restore.
- Logica de calcul a celulelor șterse (deja corectă după ultimul fix).

---

## Rezultat așteptat
- O singură listă cronologică, grupată pe zile, ușor de scanat.
- Vezi din prima „cine + ce + câte celule" fără să deschizi modalul.
- Fără coloane tehnice redundante, fără rânduri goale, identitate vizuală clară.
- Cod mai curat: stiluri centralizate, un singur model de eveniment, modale deduplicate.

## Build după implementare
```bash
docker compose up -d --build frontend
```
