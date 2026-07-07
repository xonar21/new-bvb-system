package sheetapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"bvb-datatable/internal/sheetdoc"
	"bvb-datatable/internal/ws"
)

type Sync struct {
	client    *Client
	sheetRepo *sheetdoc.Repository
	wsHub     *ws.Hub
}

func NewSync(client *Client, sheetRepo *sheetdoc.Repository, wsHub *ws.Hub) *Sync {
	return &Sync{
		client:    client,
		sheetRepo: sheetRepo,
		wsHub:     wsHub,
	}
}

// Cell representa o celulă din celldata.
type Cell struct {
	R int                   `json:"r"`
	C int                   `json:"c"`
	V map[string]interface{} `json:"v"`
}

// Sheet e una din foile din workbook.
type Sheet struct {
	Name     string                 `json:"name"`
	ID       string                 `json:"id"`
	Celldata []Cell                 `json:"celldata"`
	Config   map[string]interface{} `json:"config,omitempty"`
}

// Run execută un ciclu de sync: fetch API → merge în sheet → salvează + broadcast.
func (s *Sync) Run(ctx context.Context) error {
	loads, err := s.client.FetchAll(ctx)
	if err != nil {
		log.Printf("[MCC Sync] FetchAll error: %v", err)
		s.wsHub.Broadcast(ws.Message{Type: "mcc.error", Payload: map[string]interface{}{"error": err.Error()}})
		return err
	}

	log.Printf("[MCC Sync] fetched %d loads from API", len(loads))

	// Citește sheet-ul curent
	doc, err := s.sheetRepo.Get(ctx)
	if err != nil {
		return fmt.Errorf("get sheet document: %w", err)
	}

	docName := "Loads"
	var sheets []Sheet
	if doc == nil || len(doc.Data) == 0 || string(doc.Data) == "{}" {
		sheets = []Sheet{{Name: "AB Loads", ID: "sheet-1", Celldata: []Cell{}}}
	} else {
		if doc.Name != "" {
			docName = doc.Name
		}
		if err := json.Unmarshal(doc.Data, &sheets); err != nil {
			return fmt.Errorf("unmarshal sheets: %w", err)
		}
	}

	// Găsește indexul foii „AB Loads" (sau o creează)
	sheetIdx := -1
	for i := range sheets {
		if strings.EqualFold(sheets[i].Name, "AB Loads") {
			sheetIdx = i
			break
		}
	}
	if sheetIdx == -1 {
		sheets = append(sheets, Sheet{
			Name:     "AB Loads",
			ID:       "sheet-1",
			Celldata: []Cell{},
			Config: map[string]interface{}{
				"columnlen": map[string]interface{}{
					"0": 120, "1": 100, "2": 200, "3": 250, "4": 150, "5": 120, "6": 100, "7": 80,
				},
			},
		})
		sheetIdx = len(sheets) - 1
	}
	sheet := &sheets[sheetIdx]

	// Inițializează config dacă lipsește
	if sheet.Config == nil {
		sheet.Config = make(map[string]interface{})
	}
	if _, ok := sheet.Config["columnlen"]; !ok {
		sheet.Config["columnlen"] = map[string]interface{}{
			"0": 120, "1": 100, "2": 200, "3": 250, "4": 150, "5": 120, "6": 100, "7": 80,
		}
	}

	// Ensure banner row (rândul 0) exists
	ensureBannerRow(sheet)

	// Construiește index după gate code (col F = c:5)
	index := make(map[string]int)
	maxRow := 0
	for _, cell := range sheet.Celldata {
		if cell.C == 5 && cell.R > 0 { // col F, skip banner
			if vInterface, ok := cell.V["v"]; ok {
				gateCode := fmt.Sprintf("%v", vInterface)
				normGate := normalizeGateCode(gateCode)
				index[normGate] = cell.R
				if cell.R > maxRow {
					maxRow = cell.R
				}
			}
		}
	}

	// Merge: upsert API loads în sheet
	today := time.Now().Truncate(24 * time.Hour)
	tomorrow := today.AddDate(0, 0, 1)

	apiGates := make(map[string]bool)
	noGateCodeCount := 0
	for _, load := range loads {
		if load.GateCode == "" {
			noGateCodeCount++
			log.Printf("[MCC Sync] load without gateCode: %s → %s (%s)", load.OriginCity, load.DestCity, load.Equipment)
			continue // skip loads without gate code
		}

		norm := normalizeGateCode(load.GateCode)
		apiGates[norm] = true

		pickupDate := load.PickupDate.Truncate(24 * time.Hour)
		isToday := pickupDate == today
		isTomorrow := pickupDate == tomorrow

		cells := cellsForLoad(load, isToday, isTomorrow)

		if r, exists := index[norm]; exists {
			// UPDATE: scrie coloanele API pe rândul existent
			for c, cellVal := range cells {
				setCell(sheet, r, c, cellVal)
			}
		} else {
			// INSERT: rând nou
			r = maxRow + 1
			maxRow = r
			for c, cellVal := range cells {
				setCell(sheet, r, c, cellVal)
			}
		}
	}

	// Marker "gone" loads: cele care erau în index dar nu mai vin din API
	for norm, r := range index {
		if !apiGates[norm] {
			log.Printf("[MCC Sync] load %s gone from API (rând %d)", norm, r)
		}
	}

	// Sort by date (ascending)
	sortByDate(sheet)

	// Serializează înapoi
	data, err := json.Marshal(sheets)
	if err != nil {
		return fmt.Errorf("marshal sheets: %w", err)
	}

	// Upsert în sheet_documents (foaia pe care o văd userii) + versiune mcc_sync.
	if err := s.sheetRepo.SaveFromSync(ctx, docName, data, "mcc_sync"); err != nil {
		return fmt.Errorf("save sheet: %w", err)
	}

	importedCount := len(loads) - noGateCodeCount
	log.Printf("[MCC Sync] merged %d loads into sheet (skipped %d without gateCode), saved", importedCount, noGateCodeCount)

	// Broadcast WS
	s.wsHub.Broadcast(ws.Message{
		Type: "mcc.synced",
		Payload: map[string]interface{}{
			"count":     len(loads),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})

	return nil
}

func normalizeGateCode(code string) string {
	// Strip leading zeros: "0031073812" → "31073812"
	norm := strings.TrimLeft(code, "0")
	if norm == "" {
		norm = "0"
	}
	return norm
}

func cellsForLoad(l SheetLoad, isToday, isTomorrow bool) map[int]map[string]interface{} {
	cells := make(map[int]map[string]interface{})

	// A: Pickup date — right align, colored (azi=red, maine=yellow)
	dateStr := l.PickupDate.Format("1/2/2006")
	cellA := map[string]interface{}{"v": dateStr, "m": dateStr, "ha": "right"}
	if isToday {
		cellA["bg"] = "#e06666" // red
	} else if isTomorrow {
		cellA["bg"] = "#ffff00" // yellow
	}
	cells[0] = cellA

	// B: Commodity — map equipment to DRY/REEFER, left align
	commodity := "DRY"
	if l.Equipment != "VAN" && l.Equipment != "" {
		commodity = "REEFER"
	}
	cells[1] = map[string]interface{}{"v": commodity, "m": commodity, "al": "left"}

	// C: Pickup city, state, time — center align
	pickupStr := strings.TrimSpace(fmt.Sprintf("%s, %s %s", l.OriginCity, l.OriginState, l.PickupTime))
	cells[2] = map[string]interface{}{"v": pickupStr, "m": pickupStr, "al": "center"}

	// D: Delivery city, state, date, time — center align
	deliveryStr := strings.TrimSpace(fmt.Sprintf("%s, %s %s %s",
		l.DestCity, l.DestState, l.DeliveryDate.Format("01/02"), l.DeliveryTime))
	cells[3] = map[string]interface{}{"v": deliveryStr, "m": deliveryStr, "al": "center"}

	// E: Empty (manual notes) — center align
	cells[4] = map[string]interface{}{"v": "", "m": "", "al": "center"}

	// F: Gate code — center align (skip if empty)
	if l.GateCode != "" {
		cells[5] = map[string]interface{}{"v": l.GateCode, "m": l.GateCode, "ha": "center"}
	}

	// G: Rate — right align, always gray background
	cells[6] = map[string]interface{}{"v": "", "m": "", "al": "right", "bg": "#cccccc"}

	// H: HOT (if applicable) — center align, bold, red text
	if l.IsHot {
		cells[7] = map[string]interface{}{
			"v":  "HOT",
			"m":  "HOT",
			"al": "center",
			"bl": 1,           // bold
			"fc": "#ff0000",   // red
		}
	}

	return cells
}

func setCell(sheet *Sheet, r, c int, cellVal map[string]interface{}) {
	for i := range sheet.Celldata {
		if sheet.Celldata[i].R == r && sheet.Celldata[i].C == c {
			sheet.Celldata[i].V = cellVal
			return
		}
	}
	sheet.Celldata = append(sheet.Celldata, Cell{
		R: r,
		C: c,
		V: cellVal,
	})
}

// ensureBannerRow ensures rândul 0 (banner) exists with status message
func ensureBannerRow(sheet *Sheet) {
	hasBanner := false
	for _, cell := range sheet.Celldata {
		if cell.R == 0 && cell.C == 0 {
			hasBanner = true
			break
		}
	}
	if !hasBanner {
		sheet.Celldata = append(sheet.Celldata, Cell{
			R: 0,
			C: 0,
			V: map[string]interface{}{
				"v":  "✅ Sheet is available",
				"m":  "✅ Sheet is available",
				"bg": "#d4edda",
				"fc": "#155724",
			},
		})
	}
}

// sortByDate sorts celldata by date in column 0 (ascending)
func sortByDate(sheet *Sheet) {
	sort.Slice(sheet.Celldata, func(i, j int) bool {
		ci, cj := sheet.Celldata[i], sheet.Celldata[j]
		if ci.C != 0 || cj.C != 0 {
			return false // not in column A
		}
		ri, rj := ci.R, cj.R
		if ri == 0 || rj == 0 {
			return ri < rj // banner first
		}
		// Extract date strings and compare
		vi, _ := ci.V["v"].(string)
		vj, _ := cj.V["v"].(string)
		// Format is "1/2/2006", compare as-is (lexicographic works for M/D/YYYY)
		return vi < vj
	})
}
