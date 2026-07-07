package sheetapi

import (
	"bytes"
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

// Cell = o celulă din celldata (format sparse Fortune Sheet).
type Cell struct {
	R int                    `json:"r"`
	C int                    `json:"c"`
	V map[string]interface{} `json:"v"`
}

// row = un rând de date (toate celulele lui) + data de pickup (pentru sortare).
type row struct {
	date  time.Time
	cells []Cell
}

const targetSheetName = "AB Loads"

// Run: fetch API → adaugă DOAR gate code-uri noi → re-sortează după dată → salvează.
// NU atinge rândurile existente (editările userului rămân). NU pierde câmpurile foii.
func (s *Sync) Run(ctx context.Context) error {
	loads, err := s.client.FetchAll(ctx)
	if err != nil {
		log.Printf("[MCC Sync] FetchAll error: %v", err)
		s.wsHub.Broadcast(ws.Message{Type: "mcc.error", Payload: map[string]interface{}{"error": err.Error()}})
		return err
	}
	log.Printf("[MCC Sync] fetched %d loads from API", len(loads))

	doc, err := s.sheetRepo.Get(ctx)
	if err != nil {
		return fmt.Errorf("get sheet document: %w", err)
	}

	// Deserializăm foile ca map-uri generice → NU pierdem niciun câmp Fortune Sheet
	// (row, column, status, order, merge, frozen, config etc.).
	docName := "Loads"
	var sheets []map[string]interface{}
	if doc != nil && len(doc.Data) > 0 && string(doc.Data) != "{}" {
		if doc.Name != "" {
			docName = doc.Name
		}
		if err := json.Unmarshal(doc.Data, &sheets); err != nil {
			return fmt.Errorf("unmarshal sheets: %w", err)
		}
	}

	// Găsește (sau creează) foaia „AB Loads".
	sheetIdx := -1
	for i := range sheets {
		if name, _ := sheets[i]["name"].(string); strings.EqualFold(name, targetSheetName) {
			sheetIdx = i
			break
		}
	}
	if sheetIdx == -1 {
		sheets = append(sheets, map[string]interface{}{
			"name":     targetSheetName,
			"id":       "sheet-mcc",
			"status":   1,
			"order":    len(sheets),
			"row":      200,
			"column":   8,
			"celldata": []Cell{},
		})
		sheetIdx = len(sheets) - 1
	}
	sheet := sheets[sheetIdx]

	// Extrage celulele existente.
	existingCells := extractCells(sheet["celldata"])

	// Indexează rândurile existente după gate code.
	rowsByIdx := map[int][]Cell{}
	existingGates := map[string]bool{}
	for _, c := range existingCells {
		rowsByIdx[c.R] = append(rowsByIdx[c.R], c)
		if c.C == 5 {
			if v, ok := c.V["v"]; ok {
				existingGates[normalizeGateCode(fmt.Sprintf("%v", v))] = true
			}
		}
	}

	// Rândurile existente rămân EXACT cum sunt (păstrăm toate coloanele + stilurile).
	var allRows []row
	for _, cells := range rowsByIdx {
		allRows = append(allRows, row{date: parseRowDate(cells), cells: cells})
	}

	// Adaugă DOAR loadurile cu gate code nou.
	now := time.Now().UTC()
	ty, tmo, td := now.Date()
	nx := now.AddDate(0, 0, 1)
	ny, nmo, nd := nx.Date()

	added, skippedNoGate, skippedExisting := 0, 0, 0
	for _, l := range loads {
		if l.GateCode == "" {
			skippedNoGate++
			continue
		}
		norm := normalizeGateCode(l.GateCode)
		if existingGates[norm] {
			skippedExisting++
			continue // deja în sheet → nu-l atingem
		}
		existingGates[norm] = true

		py, pmo, pd := l.PickupDate.UTC().Date()
		isToday := py == ty && pmo == tmo && pd == td
		isTomorrow := py == ny && pmo == nmo && pd == nd

		allRows = append(allRows, row{date: l.PickupDate, cells: newRowCells(l, isToday, isTomorrow)})
		added++
	}

	// Re-sortează TOATE rândurile după dată (crescător). Datele neparsabile la coadă.
	sort.SliceStable(allRows, func(i, j int) bool {
		return allRows[i].date.Before(allRows[j].date)
	})

	// Reconstruiește celldata: rândurile de la r=0 în sus (fără banner).
	var outCells []Cell
	for i, rw := range allRows {
		r := i
		for _, c := range rw.cells {
			c.R = r
			outCells = append(outCells, c)
		}
	}
	sheet["celldata"] = outCells

	// Config: pune columnlen default DOAR dacă lipsește (nu suprascrie ce a setat userul).
	config, _ := sheet["config"].(map[string]interface{})
	if config == nil {
		config = map[string]interface{}{}
	}
	if _, has := config["columnlen"]; !has {
		config["columnlen"] = map[string]interface{}{
			"0": 110, "1": 90, "2": 220, "3": 260, "4": 150, "5": 120, "6": 90, "7": 70,
		}
	}
	sheet["config"] = config
	sheets[sheetIdx] = sheet

	data, err := json.Marshal(sheets)
	if err != nil {
		return fmt.Errorf("marshal sheets: %w", err)
	}

	// Skip dacă nimic nu s-a schimbat (evită versiuni + broadcast inutile la fiecare 5 min).
	if doc != nil && bytes.Equal(data, doc.Data) {
		log.Printf("[MCC Sync] no change (added=0, skippedExisting=%d) — skip save", skippedExisting)
		return nil
	}

	if err := s.sheetRepo.SaveFromSync(ctx, docName, data, "mcc_sync"); err != nil {
		return fmt.Errorf("save sheet: %w", err)
	}

	log.Printf("[MCC Sync] added %d new loads (skipped %d existing, %d without gate), re-sorted, saved",
		added, skippedExisting, skippedNoGate)

	s.wsHub.Broadcast(ws.Message{
		Type: "mcc.synced",
		Payload: map[string]interface{}{
			"added":     added,
			"total":     len(allRows),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
	return nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// extractCells convertește sheet["celldata"] (generic) în []Cell.
func extractCells(raw interface{}) []Cell {
	if raw == nil {
		return nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var cells []Cell
	if err := json.Unmarshal(b, &cells); err != nil {
		return nil
	}
	return cells
}

// parseRowDate ia data din coloana A (c==0) a unui rând. Neparsabil → dată mare (la coadă).
func parseRowDate(cells []Cell) time.Time {
	for _, c := range cells {
		if c.C == 0 {
			if s, ok := c.V["v"].(string); ok {
				if t, err := time.Parse("1/2/2006", strings.TrimSpace(s)); err == nil {
					return t
				}
			}
		}
	}
	return time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
}

// normalizeGateCode: strip zerouri la început (0031073812 → 31073812).
func normalizeGateCode(code string) string {
	norm := strings.TrimLeft(strings.TrimSpace(code), "0")
	if norm == "" {
		return "0"
	}
	return norm
}

// newRowCells construiește celulele unui rând nou din API.
// Aliniere: ht numeric (0=centru, 1=stânga, 2=dreapta).
func newRowCells(l SheetLoad, isToday, isTomorrow bool) []Cell {
	commodity := "DRY"
	if l.Equipment != "VAN" && l.Equipment != "" {
		commodity = "REEFER"
	}

	dateStr := l.PickupDate.Format("1/2/2006")
	cellA := map[string]interface{}{"v": dateStr, "m": dateStr, "ht": 2} // dreapta
	if isToday {
		cellA["bg"] = "#e06666"
	} else if isTomorrow {
		cellA["bg"] = "#ffff00"
	}

	pickup := strings.TrimSpace(fmt.Sprintf("%s, %s %s", l.OriginCity, l.OriginState, l.PickupTime))
	delivery := strings.TrimSpace(fmt.Sprintf("%s, %s %s %s",
		l.DestCity, l.DestState, l.DeliveryDate.Format("01/02"), l.DeliveryTime))

	cells := []Cell{
		{C: 0, V: cellA},
		{C: 1, V: map[string]interface{}{"v": commodity, "m": commodity, "ht": 1}},              // B stânga
		{C: 2, V: map[string]interface{}{"v": pickup, "m": pickup, "ht": 0}},                    // C centru
		{C: 3, V: map[string]interface{}{"v": delivery, "m": delivery, "ht": 0}},                // D centru
		{C: 4, V: map[string]interface{}{"v": "", "m": "", "ht": 0}},                            // E centru (manual)
		{C: 5, V: map[string]interface{}{"v": l.GateCode, "m": l.GateCode, "ht": 0}},            // F centru
		{C: 6, V: map[string]interface{}{"v": "", "m": "", "ht": 2, "bg": "#cccccc"}},           // G dreapta, gri
	}
	if l.IsHot {
		cells = append(cells, Cell{C: 7, V: map[string]interface{}{
			"v": "HOT", "m": "HOT", "ht": 0, "bl": 1, "fc": "#000000", "bg": "#ff0000", // H centru, bold negru, fundal roșu
		}})
	}
	return cells
}
