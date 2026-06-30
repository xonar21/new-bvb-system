package mcc

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"bvb-datatable/internal/sheetdoc"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sync orchestrates MCC shipment scraping, normalization, and sheet integration
type Sync struct {
	mu           sync.Mutex
	isSyncing    bool
	client       *Client
	scraper      *Scraper
	repo         *Repository
	db           *pgxpool.Pool
	sheetDocRepo *sheetdoc.Repository
	onComplete   func(inserted, updated int)
	onError      func(err error)
}

// NewSync creates a new MCC sync orchestrator
func NewSync(client *Client, scraper *Scraper, repo *Repository, db *pgxpool.Pool,
	sheetDocRepo *sheetdoc.Repository) *Sync {
	return &Sync{
		client:       client,
		scraper:      scraper,
		repo:         repo,
		db:           db,
		sheetDocRepo: sheetDocRepo,
	}
}

// SetCallbacks sets the completion and error callbacks
func (s *Sync) SetCallbacks(onComplete func(int, int), onError func(error)) {
	s.onComplete = onComplete
	s.onError = onError
}

// Sync performs the full MCC synchronization
func (s *Sync) Sync(ctx context.Context) error {
	s.mu.Lock()
	if s.isSyncing {
		s.mu.Unlock()
		return fmt.Errorf("mcc sync already in progress, please wait")
	}
	s.isSyncing = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isSyncing = false
		s.mu.Unlock()
	}()

	start := time.Now()
	log.Println("Starting MCC JDA sync...")

	// Step 1: Scrape from JDA
	html, err := s.client.FetchLoadTable("1422331")
	if err != nil {
		err = fmt.Errorf("mcc fetch failed: %w", err)
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}

	// Step 2: Parse HTML
	rawShipments, err := s.scraper.ParseLoadTable(html)
	if err != nil {
		err = fmt.Errorf("mcc parse failed: %w", err)
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}

	log.Printf("MCC: scraped %d shipments", len(rawShipments))

	// Step 3: Normalize and upsert
	inserted, updated := 0, 0
	var syncedShipments []*MccShipment

	for _, raw := range rawShipments {
		last, err := s.repo.GetLastByTrackingNumber(ctx, raw.LoadTrackingNumber)
		if err != nil {
			log.Printf("Error fetching last version for %s: %v", raw.LoadTrackingNumber, err)
			continue
		}

		// Skip if locked
		if last != nil && last.IsLock {
			log.Printf("MCC: skipping locked shipment %s", raw.LoadTrackingNumber)
			continue
		}

		// Check if anything changed
		if last != nil && !shipmentChanged(last, &raw) {
			log.Printf("MCC: no changes for %s", raw.LoadTrackingNumber)
			continue
		}

		shipment, err := s.repo.Upsert(ctx, &raw, last)
		if err != nil {
			log.Printf("Error upserting %s: %v", raw.LoadTrackingNumber, err)
			continue
		}

		syncedShipments = append(syncedShipments, shipment)
		if last == nil {
			inserted++
		} else {
			updated++
		}
	}

	log.Printf("MCC: inserted %d, updated %d", inserted, updated)

	// Step 4: Merge into sheet (if any changes)
	if len(syncedShipments) > 0 {
		if err := s.mergeIntoSheet(ctx, syncedShipments); err != nil {
			log.Printf("Error merging into sheet: %v", err)
			// Don't fail the sync, just log the error
		}
	}

	duration := time.Since(start)
	log.Printf("MCC sync completed in %v", duration)

	if s.onComplete != nil {
		s.onComplete(inserted, updated)
	}

	return nil
}

// mergeIntoSheet updates the Fortune Sheet with MCC data
func (s *Sync) mergeIntoSheet(ctx context.Context, shipments []*MccShipment) error {
	// Get current sheet document
	doc, err := s.sheetDocRepo.GetByID(ctx, 1)
	if err != nil {
		return fmt.Errorf("get sheet doc failed: %w", err)
	}

	if doc == nil || len(doc.Data) == 0 {
		log.Println("MCC: sheet document empty, skipping merge")
		return nil
	}

	// Save old data for version tracking
	oldData := doc.Data

	// Parse workbook structure
	var sheets []map[string]interface{}
	if err := json.Unmarshal(doc.Data, &sheets); err != nil {
		return fmt.Errorf("parse sheet json failed: %w", err)
	}

	if len(sheets) == 0 {
		return fmt.Errorf("no sheets found in document")
	}

	// Find "AB Loads" sheet
	var targetSheetIdx int
	var targetSheet map[string]interface{}
	for i, sheet := range sheets {
		if name, ok := sheet["name"]; ok && name == "AB Loads" {
			targetSheet = sheet
			targetSheetIdx = i
			break
		}
	}

	if targetSheet == nil {
		log.Println("MCC: AB Loads sheet not found, skipping merge")
		return nil
	}

	// Extract celldata array
	var celldata []map[string]interface{}
	if cd, ok := targetSheet["celldata"]; ok {
		if cdList, ok := cd.([]interface{}); ok {
			for _, c := range cdList {
				if cellMap, ok := c.(map[string]interface{}); ok {
					celldata = append(celldata, cellMap)
				}
			}
		}
	}

	// Apply MCC updates to cells
	updated := false
	for _, shipment := range shipments {
		if shipment.IsLock {
			continue
		}

		// Find or create row for this tracking number
		row := findOrCreateRowForTracking(celldata, shipment.LoadTrackingNumber)

		// Update only MCC scrape columns (indices as per sheet structure)
		// Adjust these based on actual column positions
		setCellValue(&celldata, row, 0, shipment.OriginAddress)                         // Origin
		setCellValue(&celldata, row, 1, shipment.DestinationAddress)                    // Destination
		setCellValue(&celldata, row, 2, shipment.StartDatetime)                         // Start Date
		setCellValue(&celldata, row, 3, shipment.EndDatetime)                           // End Date
		setCellValue(&celldata, row, 4, shipment.Commodity)                             // Commodity
		setCellValue(&celldata, row, 5, formatFloatValue(shipment.TotalDistanceMiles))  // Distance
		setCellValue(&celldata, row, 6, formatFloatValue(shipment.TotalCostUSD))        // Cost
		updated = true
	}

	if !updated {
		log.Println("MCC: no cells updated, skipping version")
		return nil
	}

	// Save celldata back to sheet
	targetSheet["celldata"] = celldata
	sheets[targetSheetIdx] = targetSheet

	// Marshal new data
	newData, err := json.Marshal(sheets)
	if err != nil {
		return fmt.Errorf("marshal sheet json failed: %w", err)
	}

	// Create version before updating
	if err := s.sheetDocRepo.CreateVersion(ctx, int(doc.ID), oldData, "mcc_sync", nil, "mcc-sync@system"); err != nil {
		log.Printf("Error creating version: %v", err)
	}

	// Update document
	if err := s.sheetDocRepo.Update(ctx, int(doc.ID), newData); err != nil {
		return fmt.Errorf("update sheet doc failed: %w", err)
	}

	return nil
}

// Helper functions for sheet merging

func findOrCreateRowForTracking(celldata []map[string]interface{}, trackingNumber string) int {
	// Search for existing row with this tracking number (column 5)
	for _, cell := range celldata {
		if c, ok := cell["c"]; ok {
			if col, ok := c.(float64); ok && col == 5 {
				if v, ok := cell["v"]; ok {
					if val, ok := v.(string); ok && val == trackingNumber {
						if r, ok := cell["r"]; ok {
							if row, ok := r.(float64); ok {
								return int(row)
							}
						}
					}
				}
			}
		}
	}
	// Not found - use next available row
	maxRow := -1
	for _, cell := range celldata {
		if r, ok := cell["r"]; ok {
			if row, ok := r.(float64); ok && int(row) > maxRow {
				maxRow = int(row)
			}
		}
	}
	return maxRow + 1
}

func setCellValue(celldata *[]map[string]interface{}, row int, col int, value interface{}) {
	// Find existing cell at row, col
	for i, cell := range *celldata {
		r, rOk := cell["r"]
		c, cOk := cell["c"]
		if rOk && cOk {
			rval, rOkFloat := r.(float64)
			cval, cOkFloat := c.(float64)
			if rOkFloat && cOkFloat {
				if int(rval) == row && int(cval) == col {
					(*celldata)[i]["v"] = value
					return
				}
			}
		}
	}
	// Create new cell
	newCell := map[string]interface{}{
		"r": float64(row),
		"c": float64(col),
		"v": value,
	}
	*celldata = append(*celldata, newCell)
}

func formatFloatValue(nf interface{}) string {
	// Handle sql.NullFloat64 interface
	switch v := nf.(type) {
	case map[string]interface{}:
		if valid, ok := v["Valid"].(bool); ok && valid {
			if f, ok := v["Float64"].(float64); ok {
				return fmt.Sprintf("%.2f", f)
			}
		}
		return ""
	}
	return ""
}

// shipmentChanged detects if scrape data differs from last version
func shipmentChanged(last *MccShipment, raw *RawMccShipment) bool {
	// Compare numeric fields (normalized)
	if !floatEqual(last.TotalDistanceMiles, parseFloat(raw.TotalDistanceMiles)) {
		return true
	}
	if !floatEqual(last.TotalCostUSD, parseFloat(raw.TotalCostUSD)) {
		return true
	}
	if !floatEqual(last.WeightLB, parseFloat(raw.WeightLB)) {
		return true
	}
	if !floatEqual(last.VolumeCuFT, parseFloat(raw.VolumeCuFT)) {
		return true
	}

	// Compare text fields
	if last.OriginAddress != raw.OriginAddress {
		return true
	}
	if last.DestinationAddress != raw.DestinationAddress {
		return true
	}
	if last.StartDatetime != raw.StartDatetime {
		return true
	}
	if last.EndDatetime != raw.EndDatetime {
		return true
	}
	if last.Commodity != raw.Commodity {
		return true
	}
	if last.Service != raw.Service {
		return true
	}
	if last.TrailerEquipmentType != raw.TrailerEquipmentType {
		return true
	}

	// Compare int fields
	if !int32Equal(last.StopsInTransit, parseInt32(raw.StopsInTransit)) {
		return true
	}
	if !int32Equal(last.TotalPieces, parseInt32(raw.TotalPieces)) {
		return true
	}
	if !int32Equal(last.TotalPallets, parseInt32(raw.TotalPallets)) {
		return true
	}

	return false
}

func floatEqual(a, b interface{}) bool {
	// Convert to sql.NullFloat64 if needed
	var af, bf float64
	var av, bv bool

	switch v := a.(type) {
	case map[string]interface{}:
		if valid, ok := v["Valid"].(bool); ok {
			av = valid
			if f, ok := v["Float64"].(float64); ok {
				af = f
			}
		}
	}

	switch v := b.(type) {
	case map[string]interface{}:
		if valid, ok := v["Valid"].(bool); ok {
			bv = valid
			if f, ok := v["Float64"].(float64); ok {
				bf = f
			}
		}
	}

	if !av && !bv {
		return true
	}
	if av != bv {
		return false
	}
	// Allow small floating point differences
	return (af - bf) < 0.01 && (af-bf) > -0.01
}

func int32Equal(a, b interface{}) bool {
	var ai, bi int32
	var av, bv bool

	switch v := a.(type) {
	case map[string]interface{}:
		if valid, ok := v["Valid"].(bool); ok {
			av = valid
			if i, ok := v["Int32"].(float64); ok {
				ai = int32(i)
			}
		}
	}

	switch v := b.(type) {
	case map[string]interface{}:
		if valid, ok := v["Valid"].(bool); ok {
			bv = valid
			if i, ok := v["Int32"].(float64); ok {
				bi = int32(i)
			}
		}
	}

	if !av && !bv {
		return true
	}
	if av != bv {
		return false
	}
	return ai == bi
}
