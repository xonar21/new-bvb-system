# Sheet API — Integration Guide for sheet.dashboard-bvbfreight.com

## What this is

A new, key-scoped read/write API on `bvbconnect.com` (this backend) that lets the
**separate project** `sheet.dashboard-bvbfreight.com` read MCC/BudExchange loads and
write back the KDA load number — replacing the old workflow where BVB pulled that
data from a manually maintained Google Sheet.

It follows the exact same pattern already used for the `bvb-mobile` integration
(`/api/v1/mobile/loads`, guarded by `RATECON_API_KEY`), but with its **own separate
key** so the two integrations can never access each other's routes.

Status: **backend implementation done, tested locally, ready for the sheet side to
be wired up.** Nothing on the sheet.dashboard-bvbfreight.com side exists yet — that
is the next developer's job.

## Auth

- Header: `X-Api-Key: <SHEET_API_KEY>`
- Env var: `SHEET_API_KEY` (see `.env.example`, and the real value is in the
  deployment's `.env` — not committed to git).
- If `SHEET_API_KEY` is unset on the server, both endpoints return `503` (fail-closed
  by design — see `internal/middleware/api_key.go`).
- Wrong/missing key → `401 {"error": "invalid api key"}`.
- This key **only** works on `/api/v1/sheet/*`. It will not authenticate against
  `/api/v1/mobile/loads` or `/api/v1/rate-confirmations` (those use
  `RATECON_API_KEY`), and vice versa. Verified manually — see "Testing done" below.

**Action needed:** generate a production `SHEET_API_KEY` (e.g. `openssl rand -hex 32`)
and share it out-of-band with whoever builds the sheet.dashboard-bvbfreight.com side.
Do not reuse the local/dev key that may already be in the repo's `.env`.

## Endpoints

### `GET /api/v1/sheet/loads`

Returns loads where `source IN (MCC, BUDEXCHANGE)` — the two sources that used to
live only in the Google Sheet. Response shape is `AdminLoadListResponse` (same DTO
as `/api/v1/mobile/loads`), which includes `gateCode` and `kdaLoadNumber`.

Query params — same as `domain.LoadFilters` (see `internal/domain/load.go`):
`status`, `origin`, `origin_state`, `destination`, `dest_state`, `equipment`,
`load_type`, `capacity`, `commodity`, `gate_code`, `pickup_from`, `pickup_to`,
`weight_min`, `weight_max`, `sort`, `page`, `limit`, `cursor`.

The `source` filter is **hardcoded server-side** to `[MCC, BUDEXCHANGE]` — it cannot
be overridden by the caller (there's no `source` query param).

Example:

```bash
curl -H "X-Api-Key: $SHEET_API_KEY" \
  "https://bvbconnect.com/api/v1/sheet/loads?status=ACTIVE&limit=50"
```

Response:

```json
{
  "data": [
    {
      "id": 445,
      "gateCode": "TESTGATE1",
      "source": "MCC",
      "kdaLoadNumber": "",
      "originCity": "Columbus",
      "...": "... full AdminLoadResponse fields ..."
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

### `POST /api/v1/sheet/loads/kda-number`

Sets the KDA load number for the load matching a gate code. This is the same update
that `internal/sync/connectors/kda_list_sheet.go` (`KDAListEnricherConnector`)
performs today by periodically pulling a Google Sheet — this endpoint lets the sheet
project push the same value directly instead, on its own schedule/trigger.

Body:

```json
{
  "gateCode": "TESTGATE1",
  "kdaLoadNumber": "KDA-999"
}
```

Responses:

- `200 {"updated": true}` — load found and updated.
- `404 {"error": "load not found for gate code"}` — no load with that gate code.
- `400` — missing `gateCode` or `kdaLoadNumber` in the body.

Example:

```bash
curl -X POST -H "X-Api-Key: $SHEET_API_KEY" -H "Content-Type: application/json" \
  -d '{"gateCode":"TESTGATE1","kdaLoadNumber":"KDA-999"}' \
  https://bvbconnect.com/api/v1/sheet/loads/kda-number
```

## Where the code lives (backend)

| Concern | File |
|---|---|
| Route registration | `backend/cmd/server/main.go` (search `sheet/loads`) |
| Auth middleware | `backend/internal/middleware/api_key.go` — `SheetAPIKeyMiddleware()` |
| Handlers | `backend/internal/handlers/sheet_loads.go` — `SheetListLoads`, `SheetUpdateKDANumber` |
| Source filter (domain → service → repo) | `internal/domain/load.go` (`LoadFilters.Sources`), `internal/services/loads.go` (`LoadFilterParams.Sources`), `internal/services/load_adapter.go`, `internal/repository/loads.go` (`WHERE source IN (...)`) |
| KDA update | `internal/domain/load.go` (`LoadService.UpdateKDALoadNumberByGateCode`), `internal/services/loads.go`, `internal/services/load_adapter.go`, `internal/repository/loads.go` (`UpdateKDALoadNumberByGateCode`) |
| Env var docs | `.env.example` (`SHEET_API_KEY`) |

No frontend or DTO changes were needed — `dto.AdminLoadResponse` already existed and
already includes `kdaLoadNumber`/`gateCode`, so no `tygo generate` / TypeScript
regeneration was required for this change.

## Design decisions worth knowing

- **Separate key, not a shared one.** Vlad specifically asked that no other
  integration should be able to reach this API. `RATECON_API_KEY` and
  `SHEET_API_KEY` are two independent env vars checked by two independent
  middleware functions, each only attached to its own route group.
- **No DB-backed API key table.** Matches the existing simple pattern
  (`RateConAPIKeyMiddleware`) — a single shared secret per integration via env var.
  If a third external integration shows up later, or per-caller key rotation /
  revocation becomes a real requirement, that's the point to introduce a proper
  `api_keys` table with scopes. Not done now — would be premature for a two-key
  system.
- **Source filtering is a new, reusable capability**, not a one-off query. It went
  into `domain.LoadFilters` as `Sources []string` (server-set only, `form:"-"`, not
  bindable from query params) so any future handler can filter by source the same
  way, but the sheet handler is the only current caller and it hardcodes
  `[MCC, BUDEXCHANGE]`.
- **KDA update reuses the exact same field/semantics** as the existing
  `KDAListEnricherConnector` (`kda_load_number` column, keyed by `gate_code`) so
  there's exactly one source of truth for what a "KDA load number" is, whether it
  arrives via the internal Google Sheets pull or via this new API push.

## What's NOT done (next developer's scope)

1. **Generate and deploy the production `SHEET_API_KEY`** on the bvbconnect.com
   server (it is not committed to git; only `.env.example` documents the variable
   name).
2. **Build/update sheet.dashboard-bvbfreight.com** to call these two endpoints
   instead of (or in addition to) its current data source.
3. Decide whether the old internal `KDAListEnricherConnector` Google Sheets pull
   (`internal/sync/connectors/kda_list_sheet.go`) should be turned off/deprecated
   once the sheet project pushes KDA numbers via this API directly — both can run
   at the same time safely (last write wins on `kda_load_number`), but running both
   long-term is redundant.
4. If the sheet project needs additional fields beyond what `AdminLoadResponse`
   exposes, or needs to write additional fields beyond `kdaLoadNumber`, extend
   `sheet_loads.go` accordingly — do not repurpose the mobile (`RATECON_API_KEY`)
   endpoints for this.

## Testing done (local, before handing off)

- `go build ./...` — clean build.
- `go test ./...` (unit) and with `DB_HOST` set (integration) — all green, no
  regressions in existing suites.
- Ran the full stack locally via `docker compose up postgres redis backend`:
  - `GET /api/v1/sheet/loads` with no key → `401`.
  - `GET /api/v1/sheet/loads` with wrong key → `401`.
  - `GET /api/v1/sheet/loads` with correct `SHEET_API_KEY` → `200`, returns only
    MCC/BUDEXCHANGE loads.
  - `POST /api/v1/sheet/loads/kda-number` with a valid gate code → `200`, and a
    follow-up `GET` confirmed `kdaLoadNumber` was persisted.
  - `POST /api/v1/sheet/loads/kda-number` with an unknown gate code → `404`.
  - Confirmed `SHEET_API_KEY` does **not** authenticate `/api/v1/mobile/loads`
    (returns `503` there since `RATECON_API_KEY` isn't set locally — fail-closed,
    as expected).
