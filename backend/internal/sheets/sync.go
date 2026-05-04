package sheets

import (
	"context"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"bvb-datatable/internal/loads"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/api/sheets/v4"
)

const (
	greenRowRed   = 0.576
	greenRowGreen = 0.769
	greenRowBlue  = 0.490
	colorTolerance = 0.05

	sheetRange      = "A2:I1000"
	batchSize       = 100
	maxRetries      = 3
	retryDelay      = 5 * time.Second
)

type SheetsSync struct {
	client  *Client
	db      *pgxpool.Pool
	sheetID string
}

func NewSync(client *Client, db *pgxpool.Pool, sheetID string) *SheetsSync {
	return &SheetsSync{
		client:  client,
		db:      db,
		sheetID: sheetID,
	}
}

func (s *SheetsSync) Sync(ctx context.Context) error {
	start := time.Now()
	log.Println("Starting Google Sheets sync...")

	// 1. Find "AB LOADS" sheet
	spreadsheet, err := s.client.GetSpreadsheet(ctx, s.sheetID)
	if err != nil {
		return fmt.Errorf("get spreadsheet: %w", err)
	}

	var targetSheet *sheets.Sheet
	for _, sheet := range spreadsheet.Sheets {
		if strings.EqualFold(sheet.Properties.Title, "AB LOADS") {
			targetSheet = sheet
			break
		}
	}

	if targetSheet == nil {
		return fmt.Errorf("sheet 'AB LOADS' not found")
	}

	totalRows := int(targetSheet.Properties.GridProperties.RowCount)
	if totalRows <= 1 {
		log.Println("Sheet has no data rows, skipping sync")
		return nil
	}

	sheetTitle := targetSheet.Properties.Title
	log.Printf("Found sheet '%s' with %d rows", sheetTitle, totalRows)

	// 2. Read rows in chunks
	var allLoads []RawLoad
	var greenRowGateCodes []string
	processedCount := 0
	greenCount := 0

	for startRow := 2; startRow <= totalRows; startRow += batchSize {
		endRow := startRow + batchSize - 1
		if endRow > totalRows {
			endRow = totalRows
		}

		rangeStr := fmt.Sprintf("%s!A%d:I%d", sheetTitle, startRow, endRow)

		loads, greenCodes, err := s.fetchAndParseChunk(ctx, rangeStr)
		if err != nil {
			log.Printf("Error fetching rows %d-%d: %v, retrying...", startRow, endRow, err)
			if err := s.retryFetch(ctx, rangeStr); err != nil {
				return fmt.Errorf("fetch rows %d-%d after retries: %w", startRow, endRow, err)
			}
		}

		allLoads = append(allLoads, loads...)
		greenRowGateCodes = append(greenRowGateCodes, greenCodes...)
		processedCount += len(loads)
		greenCount += len(greenCodes)
	}

	// 3. Process green rows: set status='pick up' on existing loads
	if len(greenRowGateCodes) > 0 {
		s.markGreenRows(ctx, greenRowGateCodes)
	}

	// 4. Transform and upsert non-green loads
	if len(allLoads) > 0 {
		if err := s.processLoads(ctx, allLoads); err != nil {
			return fmt.Errorf("process loads: %w", err)
		}
	}

	log.Printf("Sync completed: %d processed, %d green skipped, took %v",
		processedCount, greenCount, time.Since(start))
	return nil
}

func (s *SheetsSync) fetchAndParseChunk(ctx context.Context, rangeStr string) ([]RawLoad, []string, error) {
	resp, err := s.client.GetSheetData(ctx, s.sheetID, rangeStr, true)
	if err != nil {
		return nil, nil, err
	}

	if len(resp.Sheets) == 0 || len(resp.Sheets[0].Data) == 0 {
		return nil, nil, nil
	}

	rows := resp.Sheets[0].Data[0].RowData
	var loads []RawLoad
	var greenCodes []string

	for _, row := range rows {
		if row.Values == nil {
			continue
		}

		cells := row.Values
		load, isGreen := s.parseRowData(cells)
		if load == nil {
			continue
		}

		if isGreen {
			greenCodes = append(greenCodes, load.GateCode)
			continue
		}

		loads = append(loads, *load)
	}

	return loads, greenCodes, nil
}

func (s *SheetsSync) parseRowData(cells []*sheets.CellData) (*RawLoad, bool) {
	if len(cells) < 6 {
		return nil, false
	}

	getString := func(idx int) string {
		if idx >= len(cells) || cells[idx] == nil || cells[idx].EffectiveValue == nil {
			return ""
		}
		ev := cells[idx].EffectiveValue
		if ev.StringValue != nil {
			return *ev.StringValue
		}
		if ev.NumberValue != nil {
			return fmt.Sprintf("%.0f", *ev.NumberValue)
		}
		return ""
	}

	getInt := func(idx int) int {
		s := getString(idx)
		if s == "" {
			return 0
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0
		}
		return int(f)
	}

	getDate := func(idx int) *time.Time {
		if idx >= len(cells) || cells[idx] == nil || cells[idx].EffectiveValue == nil {
			return nil
		}
		ev := cells[idx].EffectiveValue
		switch {
		case ev.NumberValue != nil:
			serial := *ev.NumberValue
			if serial < 1 {
				return nil
			}
			epoch := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
			t := epoch.Add(time.Duration(serial) * 24 * time.Hour)
			return &t
		case ev.StringValue != nil:
			for _, format := range []string{"1/2/2006", "1/2/06", "2006-01-02"} {
				t, err := time.Parse(format, *ev.StringValue)
				if err == nil {
					return &t
				}
			}
		}
		return nil
	}

	parsedDate := getDate(0)
	gateCode := getString(5)

	if parsedDate == nil || gateCode == "" {
		return nil, false
	}

	// Skip past-dated rows (before today in UTC)
	now := time.Now().UTC()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if parsedDate.Before(todayStart) {
		return nil, false
	}

	isGreen := s.isGreenRow(cells)

	rate := getInt(6)

	load := &RawLoad{
		PickUpDate:       parsedDate.Format("2006-01-02"),
		Commodity:        getString(1),
		PickupLocation:   getString(2),
		DeliveryLocation: getString(3),
		AssignedUser:     getString(4),
		GateCode:         gateCode,
		Rate:             rate,
		Hot:              getString(7),
		Notes:            getString(8),
		ParsedPickUpDate: *parsedDate,
		IsGreenRow:       isGreen,
	}

	return load, isGreen
}

func (s *SheetsSync) isGreenRow(cells []*sheets.CellData) bool {
	if len(cells) == 0 || cells[0] == nil || cells[0].EffectiveFormat == nil ||
		cells[0].EffectiveFormat.BackgroundColor == nil {
		return false
	}

	bg := cells[0].EffectiveFormat.BackgroundColor

	return math.Abs(bg.Red-greenRowRed) <= colorTolerance &&
		math.Abs(bg.Green-greenRowGreen) <= colorTolerance &&
		math.Abs(bg.Blue-greenRowBlue) <= colorTolerance
}

func (s *SheetsSync) retryFetch(ctx context.Context, rangeStr string) error {
	var lastErr error
	for i := 0; i < maxRetries; i++ {
		time.Sleep(retryDelay)
		_, err := s.client.GetSheetData(ctx, s.sheetID, rangeStr, true)
		if err == nil {
			return nil
		}
		lastErr = err
	}
	return lastErr
}

func (s *SheetsSync) markGreenRows(ctx context.Context, gateCodes []string) {
	for _, gc := range gateCodes {
		normalized := loads.NormalizeGateCode(gc)
		_, err := s.db.Exec(ctx,
			`UPDATE loads SET status = 'pick up', updated_at = NOW() WHERE gate_code_col6 = $1 AND is_lock = false`,
			normalized)
		if err != nil {
			log.Printf("Failed to mark green row %s: %v", normalized, err)
		}
	}
}

func (s *SheetsSync) processLoads(ctx context.Context, rawLoads []RawLoad) error {
	for i, l := range rawLoads {
		rawLoads[i].GateCode = loads.NormalizeGateCode(l.GateCode)
		rawLoads[i].IsMCC = loads.DetectMCC(l.Notes)
		rawLoads[i].RateMin, rawLoads[i].RateMax = loads.GetRateInterval(l.Rate)
		rawLoads[i].IsBold = strings.ToUpper(strings.TrimSpace(l.Hot)) == "HOT"
	}

	return s.batchUpsert(ctx, rawLoads)
}

func (s *SheetsSync) batchUpsert(ctx context.Context, loads []RawLoad) error {
	batch := &pgx.Batch{}

	for _, load := range loads {
		batch.Queue(`
			INSERT INTO loads (
				pick_up_date_col1, commodity_col2, pickup_date_location_col3,
				delivery_date_location_col4, assigned_user_col5, gate_code_col6,
				rate_col7, rate_min, rate_max, is_bold, is_mcc, note_mcc,
				created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
			ON CONFLICT (gate_code_col6) DO UPDATE SET
				pick_up_date_col1 = EXCLUDED.pick_up_date_col1,
				commodity_col2 = EXCLUDED.commodity_col2,
				pickup_date_location_col3 = EXCLUDED.pickup_date_location_col3,
				delivery_date_location_col4 = EXCLUDED.delivery_date_location_col4,
				assigned_user_col5 = EXCLUDED.assigned_user_col5,
				rate_col7 = EXCLUDED.rate_col7,
				rate_min = EXCLUDED.rate_min,
				rate_max = EXCLUDED.rate_max,
				is_bold = EXCLUDED.is_bold,
				is_mcc = EXCLUDED.is_mcc,
				note_mcc = EXCLUDED.note_mcc,
				updated_at = NOW()
			WHERE loads.is_lock = false
		`,
			load.PickUpDate, load.Commodity, load.PickupLocation,
			load.DeliveryLocation, load.AssignedUser, load.GateCode,
			load.Rate, load.RateMin, load.RateMax, load.IsBold,
			load.IsMCC, load.Notes)
	}

	results := s.db.SendBatch(ctx, batch)
	defer results.Close()

	for i := 0; i < batch.Len(); i++ {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("batch upsert row %d: %w", i, err)
		}
	}

	return results.Close()
}


