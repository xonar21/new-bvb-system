# MCC/JDA Integration Complete Guide

## Overview
Full implementation of MCC (JDA TMS) shipment scraping and synchronization integrated into the new-bvb-system. Syncs automatically every 5 minutes and can be triggered manually via the sidebar.

## Quick Start

### 1. Enable in Environment
Create or update `.env` with:
```bash
MCC_ENABLED=true
MCC_BASE_URL=https://abus-tms-pr1.jdadelivers.com
MCC_LOGIN_USER=BVBM
MCC_LOGIN_TOKEN=2278716|3257433|1775376|3823906|13835|3147860|3987922|1888210|1593172|2997170|2159210|2159210|2853522|1961031|4307781|4307781|1991130|2034342|
MCC_NAVPAD_CONTEXT_ID=1422331
MCC_SYNC_INTERVAL_MINUTES=5
```

### 2. Rebuild and Deploy
```bash
docker compose down --volumes
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Or just rebuild if database already exists:
```bash
docker compose up -d --build backend frontend
```

### 3. Access Dashboard
- Frontend: http://localhost:5173 (dev) or http://localhost:8080 (prod)
- Login as admin@bvb.local / admin123
- See "Sync MCC" button in sidebar (orange)
- Click to trigger manual sync or wait 5 minutes for automatic sync

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     BVB Frontend                         │
│  • Sidebar with "Sync MCC" button (admin/root only)    │
│  • Shows sync status via WS messages (mcc.synced/error) │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────┐
│                    BVB Backend (Go)                      │
│                                                          │
│  POST /api/mcc/sync (manual trigger)                    │
│          ↓                                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ mcc.Client  (JDA login & fetch)                  │  │
│  │ mcc.Scraper (HTML parsing with goquery)         │  │
│  │ mcc.Repository (DB versioning)                   │  │
│  │ mcc.Sync (orchestrator & merge)                  │  │
│  └──────────────────────────────────────────────────┘  │
│          ↓                                              │
│  PostgreSQL: mcc_shipments table                       │
│  PostgreSQL: sheet_documents (update celldata)         │
│          ↓                                              │
│  WS Broadcast: mcc.synced / mcc.error                  │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   PostgreSQL    Google Sheets   Redis (optional)
    mcc_shipments  (optional)
```

## Data Flow

### Manual Sync (Click "Sync MCC" button)
1. Frontend sends POST /api/mcc/sync
2. Backend Handler receives request (admin/root only)
3. Triggers mcc.Sync.Sync() and blocks on completion
4. Frontend waits for HTTP response and updates UI

### Automatic Sync (Every 5 minutes)
1. Backend starts goroutine on startup with ticker
2. Runs mcc.Sync.Sync() at MCCSyncInterval (5 min default)
3. Broadcasts WS message mcc.synced with insert/update counts
4. Frontend receives via WebSocket and can update UI

### Sync Process (mcc.Sync.Sync)
1. **Authenticate** → 3 JDA requests with cookie management
2. **Scrape** → Parse HTML table from JDA portal
3. **Normalize** → Convert numeric fields, handle currencies
4. **Upsert** → Version-aware insert with manual field inheritance
5. **Merge** → Update "AB Loads" sheet cells with scraped data
6. **Broadcast** → Send WS mcc.synced / mcc.error message

## Database Schema

### mcc_shipments Table
```sql
-- Versioned snapshots: same tracking_number has multiple rows per sync
CREATE TABLE mcc_shipments (
  id                      BIGSERIAL PRIMARY KEY,
  load_tracking_number    VARCHAR(255) NOT NULL,  -- key for finding versions
  
  -- Scraped fields from JDA
  row_key                 VARCHAR(255),
  load_id                 VARCHAR(255),
  response_required_by_date VARCHAR(255),
  total_distance_miles    NUMERIC(10,2),
  stops_in_transit        INTEGER,
  service                 VARCHAR(255),
  trailer_equipment_type  VARCHAR(255),
  total_cost_usd          NUMERIC(12,2),
  total_pieces            INTEGER,
  total_pallets           INTEGER,
  weight_lb               NUMERIC(12,2),
  volume_cuft             NUMERIC(12,2),
  origin_address          TEXT,
  destination_address     TEXT,
  start_datetime          VARCHAR(255),
  end_datetime            VARCHAR(255),
  commodity               VARCHAR(255),
  tender_request_id       VARCHAR(255),
  
  -- Manual fields (inherited from last version)
  rate                    INTEGER,
  rate_interval           VARCHAR(100),
  comments                TEXT,
  user_id                 BIGINT,
  is_hot                  BOOLEAN DEFAULT FALSE,
  order_number            INTEGER,
  font_size               INTEGER,
  is_bold                 BOOLEAN DEFAULT FALSE,
  status_user             VARCHAR(100),
  is_lock                 BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  is_mcc                  BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mcc_shipments_tracking ON mcc_shipments(load_tracking_number);
CREATE INDEX idx_mcc_shipments_created_at ON mcc_shipments(created_at DESC);
CREATE INDEX idx_mcc_shipments_is_lock ON mcc_shipments(is_lock);
```

## Configuration

All MCC settings in `internal/config/config.go`:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| MCCEnabled | bool | false | Enable/disable MCC sync |
| MCCBaseURL | string | https://abus-tms-pr1.jdadelivers.com | JDA portal URL |
| MCCLoginUser | string | BVBM | JDA username |
| MCCLoginToken | string | "" | Encoded login token (from JDA) |
| MCCNavpadContextID | string | 1422331 | Portal context ID |
| MCCSyncInterval | duration | 5 minutes | Auto-sync frequency |

## Key Features

✅ **Token-based Auth**: Uses pre-encoded token from environment (no plaintext password)
✅ **Cookie Management**: Maintains session across 3 JDA requests
✅ **Robust HTML Parsing**: goquery with defensive column mapping
✅ **Numeric Normalization**: Handles USD currency, comma separators
✅ **Version History**: Each tracking number has multiple versions timestamped
✅ **Manual Field Preservation**: Rate, comments, status inherited from last version
✅ **Lock Protection**: Locked records (is_lock=true) skipped during sync
✅ **No-op Detection**: Skips version if no cells changed
✅ **Error Resilience**: Failed shipments logged but don't crash sync
✅ **WebSocket Broadcast**: Real-time feedback to frontend
✅ **Admin-only**: Manual trigger restricted to admin/root users

## Sync Logic

### Version Creation
When scraping finds a shipment:

1. Look up last version by `load_tracking_number`
2. Skip if `last.is_lock == true`
3. Check if data changed (shipmentChanged helper)
4. If new or changed:
   - **Inherit** manual fields from `last`:
     - rate, rate_interval, comments, user_id, is_hot, order_number, font_size, is_bold
   - **Reset** status_user if pickup date changed
   - **Insert** new versioned row
5. If nothing changed, skip version creation

### Sheet Merge
After upsert, update "AB Loads" sheet:

1. Find "AB Loads" sheet in workbook
2. For each synced shipment (not locked):
   - Search celldata for row with matching `load_tracking_number` in column 5
   - If found, update columns 0-6 (scrape columns only):
     - Col 0: origin_address
     - Col 1: destination_address
     - Col 2: start_datetime
     - Col 3: end_datetime
     - Col 4: commodity
     - Col 5: total_distance_miles
     - Col 6: total_cost_usd
3. **Never touch** manual columns (rate, comments, status, etc.)
4. Create version with reason='mcc_sync' (preserves edit history)
5. Broadcast mcc.synced message to connected clients

## API Endpoints

### POST /api/mcc/sync
**Auth**: Bearer token + admin/root role required
**Response**:
```json
{
  "message": "mcc sync completed successfully"
}
```
**Error**:
```json
{
  "error": "mcc sync failed",
  "details": "error message details"
}
```

## WebSocket Messages

### mcc.synced
Broadcast after successful sync:
```json
{
  "type": "mcc.synced",
  "payload": {
    "inserted": 5,
    "updated": 3
  }
}
```

### mcc.error
Broadcast on sync error:
```json
{
  "type": "mcc.error",
  "payload": {
    "error": "login failed: expected 302 redirect, got 401"
  }
}
```

## Troubleshooting

### Sync Fails to Start
**Check 1**: Is MCC_ENABLED=true in .env?
```bash
docker compose exec backend grep MCC_ENABLED /app/.env
```

**Check 2**: Is MCC_LOGIN_TOKEN set and non-empty?
```bash
docker compose exec backend echo $MCC_LOGIN_TOKEN | wc -c
# Should be > 100 chars
```

**Check 3**: Check backend logs
```bash
docker compose logs backend | grep -i mcc
```

### Login Error (302 status)
**Problem**: "expected 302 redirect, got 401" in logs
**Solution**: Token expired or incorrect. Update MCC_LOGIN_TOKEN in .env and rebuild

### HTML Parsing Error
**Problem**: "load table not found in HTML"
**Solution**: JDA structure changed. Check JDA portal manually:
```bash
# From container, fetch HTML and inspect
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "ControllerAction=Login&loginPassword=$TOKEN&loginUser=BVBM" \
  https://abus-tms-pr1.jdadelivers.com/tm/admin/LoginViewController.jsp
```

### Cells Not Updating
**Check 1**: Is sheet document loaded? Check sheet_documents table:
```sql
SELECT id, name, LENGTH(data) as data_size FROM sheet_documents;
```

**Check 2**: Are tracking numbers in column 5? Check celldata structure:
```sql
SELECT id, name, data->0->>'name' as sheet_name FROM sheet_documents LIMIT 1;
```

### Performance Issues
**Check**: Sync taking > 30 seconds?
- Increase JDA delays in client.go (currently 3s)
- Check network latency to JDA portal
- Monitor DB insert performance (test with 100+ shipments)

## Monitoring

### Check Sync Status
```sql
-- Last 10 syncs
SELECT load_tracking_number, COUNT(*) as versions, MAX(created_at) as latest
FROM mcc_shipments
GROUP BY load_tracking_number
ORDER BY MAX(created_at) DESC
LIMIT 10;

-- Count recent syncs
SELECT DATE(created_at) as date, COUNT(DISTINCT load_tracking_number) as shipments
FROM mcc_shipments
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE(created_at);
```

### Check for Locked Records
```sql
SELECT COUNT(*) as locked_count FROM mcc_shipments WHERE is_lock = true;
```

### Check Version History
```sql
SELECT id, reason, created_by_email, created_at FROM sheet_versions 
WHERE reason = 'mcc_sync' 
ORDER BY created_at DESC 
LIMIT 10;
```

## Maintenance

### Token Rotation
When JDA rotates the token:

1. Get new token from JDA (ask your JDA admin)
2. Update .env: `MCC_LOGIN_TOKEN=...`
3. Restart backend:
   ```bash
   docker compose restart backend
   ```
4. Monitor logs for successful login

### Database Cleanup
Keep only recent versions (daily cron):
```sql
-- Keep last 50 versions per tracking number
DELETE FROM mcc_shipments
WHERE id IN (
  SELECT id FROM mcc_shipments m1
  WHERE (
    SELECT COUNT(*) FROM mcc_shipments m2
    WHERE m2.load_tracking_number = m1.load_tracking_number
    AND m2.created_at >= m1.created_at
  ) > 50
);
```

## Security

- ✅ Token stored in .env (never in code)
- ✅ `.env` in .gitignore (never committed)
- ✅ Login restricted to admin/root via auth middleware
- ✅ HTTP-only Bearer tokens (no localStorage cookies)
- ✅ All DB writes use parameterized queries (no SQL injection)
- ✅ MCC data merged, never replaces entire sheet

## Performance Metrics

**Expected on 5-minute sync interval:**
- JDA fetch: 5-10 seconds (3 requests + 3s delays)
- HTML parsing: 100-500ms
- DB upsert: 500-1000ms (bulk insert)
- Sheet merge: 200-500ms
- **Total**: ~10-15 seconds per cycle

**With 100+ shipments:**
- All operations scale linearly
- Large merges may take 30+ seconds
- Advisable to increase interval to 15-30 minutes for production

## Version Numbering

- Version reason='mcc_sync' — automatic sync update
- Version reason='manual' — user edited
- Version reason='before_delete' / 'after_delete' — deletion snapshot

Track sheet changes via `sheet_versions` table:
```sql
SELECT * FROM sheet_versions 
ORDER BY created_at DESC LIMIT 20;
```

## Next Steps

1. **Verify** token is correct and active in JDA
2. **Enable** MCC_ENABLED=true in production .env
3. **Build** with `docker compose up -d --build backend frontend`
4. **Monitor** first sync: `docker logs <container> | grep mcc`
5. **Test** manual sync via frontend button
6. **Wait** for automatic sync (5 min interval)
7. **Verify** cell updates in AB Loads sheet
8. **Celebrate** 🎉 MCC integration is live!

---

**Support**: Check logs with `docker compose logs backend | grep -i mcc` for debugging.
