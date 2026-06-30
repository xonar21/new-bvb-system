package mcc

import (
	"fmt"
	"log"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// Scraper parses HTML table from JDA portal
type Scraper struct {
}

// NewScraper creates a new HTML scraper
func NewScraper() *Scraper {
	return &Scraper{}
}

// ParseLoadTable extracts shipment data from HTML table
func (s *Scraper) ParseLoadTable(html string) ([]RawMccShipment, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("parse html failed: %w", err)
	}

	// Find table with id=LoadTenderListFormSEARCH_RESULTSTableID
	table := doc.Find("table#LoadTenderListFormSEARCH_RESULTSTableID")
	if table.Length() == 0 {
		// Debug: log available table IDs
		doc.Find("table").Each(func(i int, s *goquery.Selection) {
			id, _ := s.Attr("id")
			log.Printf("Found table #%d: id=%q", i, id)
		})
		return nil, fmt.Errorf("load table not found in HTML")
	}

	// Extract headers from <tr class="tableColumnHeadings">
	headers := []string{}
	table.Find("tr.tableColumnHeadings th").Each(func(i int, s *goquery.Selection) {
		headers = append(headers, strings.TrimSpace(s.Text()))
	})

	// If no <th> headers, try <td> headers
	if len(headers) == 0 {
		table.Find("tr.tableColumnHeadings td").Each(func(i int, s *goquery.Selection) {
			headers = append(headers, strings.TrimSpace(s.Text()))
		})
	}

	if len(headers) == 0 {
		// Debug: inspect table structure
		log.Printf("Table found but headers not found. Inspecting structure:")

		// Check for any tr elements
		allRows := table.Find("tr")
		log.Printf("Total rows in table: %d", allRows.Length())

		// Check for first few rows
		table.Find("tr").Each(func(i int, row *goquery.Selection) {
			if i < 3 {
				class, _ := row.Attr("class")
				cells := row.Find("td, th")
				firstCellText := ""
				if cells.Length() > 0 {
					firstCellText = strings.TrimSpace(cells.First().Text())
					if len(firstCellText) > 50 {
						firstCellText = firstCellText[:50]
					}
				}
				log.Printf("Row %d: class=%q, cells=%d, first_cell=%q", i, class, cells.Length(), firstCellText)
			}
		})

		return nil, fmt.Errorf("table headers not found")
	}

	// Build header index map
	headerMap := make(map[string]int)
	for i, h := range headers {
		headerMap[h] = i
	}

	// Parse rows - alternating tableRow0 and tableRow1 classes
	var shipments []RawMccShipment

	table.Find("tr.tableRow0, tr.tableRow1").Each(func(i int, row *goquery.Selection) {
		cells := row.Find("td")
		if cells.Length() == 0 {
			return
		}

		rowData := make([]string, len(headers))
		cells.Each(func(j int, cell *goquery.Selection) {
			if j < len(rowData) {
				// Extract text from cell, handling nested elements
				text := strings.TrimSpace(cell.Text())
				rowData[j] = text
			}
		})

		// Extract RowKey from hidden checkbox input
		rowKey := ""
		checkboxInput := row.Find("input[type='checkbox']")
		if checkboxInput.Length() > 0 {
			rk, exists := checkboxInput.Attr("value")
			if exists {
				rowKey = rk
			}
		}

		shipment := RawMccShipment{
			RowKey:                       rowKey,
			LoadID:                       getColumn(rowData, headerMap, "Load ID"),
			LoadTrackingNumber:           getColumn(rowData, headerMap, "Load Tracking Number"),
			ResponseRequiredByDate:       getColumn(rowData, headerMap, "Response Required By Date (MM/DD/YYYY HH:MM)"),
			TotalDistanceMiles:           getColumn(rowData, headerMap, "Total Distance (MILES)"),
			StopsInTransit:               getColumn(rowData, headerMap, "Stops in Transit"),
			Service:                      getColumn(rowData, headerMap, "Service"),
			TrailerEquipmentType:         getColumn(rowData, headerMap, "Trailer Equipment Type"),
			TotalCostUSD:                 getColumn(rowData, headerMap, "Total Cost - User Currency (USD)"),
			TotalPieces:                  getColumn(rowData, headerMap, "Total Pieces"),
			TotalPallets:                 getColumn(rowData, headerMap, "Total Pallets"),
			WeightLB:                     getColumn(rowData, headerMap, "Weight (LB)"),
			VolumeCuFT:                   getColumn(rowData, headerMap, "Volume (CU. FT)"),
			OriginAddress:                getColumn(rowData, headerMap, "Origin Address"),
			DestinationAddress:           getColumn(rowData, headerMap, "Destination Address"),
			StartDatetime:                getColumn(rowData, headerMap, "Start Date/Time (MM/DD/YYYY HH:MM)"),
			EndDatetime:                  getColumn(rowData, headerMap, "End Date/Time (MM/DD/YYYY HH:MM)"),
			Commodity:                    getColumn(rowData, headerMap, "Commodity"),
			TenderRequestID:              getColumn(rowData, headerMap, "Tender Request ID"),
		}

		if shipment.LoadTrackingNumber != "" {
			shipments = append(shipments, shipment)
		}
	})

	if len(shipments) == 0 {
		return nil, fmt.Errorf("no shipments found in table")
	}

	return shipments, nil
}

// getColumn helper to safely get column value by header name
func getColumn(rowData []string, headerMap map[string]int, headerName string) string {
	if idx, ok := headerMap[headerName]; ok && idx < len(rowData) {
		return rowData[idx]
	}
	return ""
}
