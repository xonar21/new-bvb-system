package sheetapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
	Name     string `json:"name"`
	ID       string `json:"id"`
	Celldata []Cell `json:"celldata"`
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
		sheets = append(sheets, Sheet{Name: "AB Loads", ID: "sheet-1", Celldata: []Cell{}})
		sheetIdx = len(sheets) - 1
	}
	sheet := &sheets[sheetIdx]

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
	apiGates := make(map[string]bool)
	for _, load := range loads {
		norm := normalizeGateCode(load.GateCode)
		apiGates[norm] = true

		cells := cellsForLoad(load)

		if r, exists := index[norm]; exists {
			// UPDATE: scrie coloanele API pe rândul existent
			for c, val := range cells {
				setCell(sheet, r, c, val)
			}
		} else {
			// INSERT: rând nou
			r = maxRow + 1
			maxRow = r
			for c, val := range cells {
				setCell(sheet, r, c, val)
			}
		}
	}

	// Marker "gone" loads: cele care erau în index dar nu mai vin din API
	for norm, r := range index {
		if !apiGates[norm] {
			log.Printf("[MCC Sync] load %s gone from API (rând %d)", norm, r)
		}
	}

	// Serializează înapoi
	data, err := json.Marshal(sheets)
	if err != nil {
		return fmt.Errorf("marshal sheets: %w", err)
	}

	// Upsert în sheet_documents (foaia pe care o văd userii) + versiune mcc_sync.
	if err := s.sheetRepo.SaveFromSync(ctx, docName, data, "mcc_sync"); err != nil {
		return fmt.Errorf("save sheet: %w", err)
	}

	log.Printf("[MCC Sync] merged %d loads into sheet, saved", len(loads))

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

func cellsForLoad(l SheetLoad) map[int]string {
	cells := map[int]string{
		0: l.PickupDate.Format("1/2/2006"),
		1: "DRY",
		2: strings.TrimSpace(fmt.Sprintf("%s, %s %s", l.OriginCity, l.OriginState, l.PickupTime)),
		3: strings.TrimSpace(fmt.Sprintf("%s, %s %s %s",
			l.DestCity, l.DestState, l.DeliveryDate.Format("01/02"), l.DeliveryTime)),
		5: l.GateCode,
	}
	if l.IsHot {
		cells[7] = "HOT"
	}
	return cells
}

func setCell(sheet *Sheet, r, c int, val string) {
	for i := range sheet.Celldata {
		if sheet.Celldata[i].R == r && sheet.Celldata[i].C == c {
			sheet.Celldata[i].V = map[string]interface{}{"v": val, "m": val}
			return
		}
	}
	sheet.Celldata = append(sheet.Celldata, Cell{
		R: r,
		C: c,
		V: map[string]interface{}{"v": val, "m": val},
	})
}
