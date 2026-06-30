package mcc

import (
	"database/sql"
	"time"
)

// RawMccShipment represents the scraped data from JDA portal (unprocessed)
type RawMccShipment struct {
	RowKey                       string
	LoadID                       string
	LoadTrackingNumber           string
	ResponseRequiredByDate       string
	TotalDistanceMiles           string
	StopsInTransit               string
	Service                      string
	TrailerEquipmentType         string
	TotalCostUSD                 string
	TotalPieces                  string
	TotalPallets                 string
	WeightLB                     string
	VolumeCuFT                   string
	OriginAddress                string
	DestinationAddress           string
	StartDatetime                string
	EndDatetime                  string
	Commodity                    string
	TenderRequestID              string
}

// MccShipment represents a versioned snapshot of MCC data in the DB
type MccShipment struct {
	ID                     int
	RowKey                 string
	LoadID                 string
	LoadTrackingNumber     string
	ResponseRequiredByDate string
	TotalDistanceMiles     sql.NullFloat64
	StopsInTransit         sql.NullInt32
	Service                string
	TrailerEquipmentType   string
	TotalCostUSD           sql.NullFloat64
	TotalPieces            sql.NullInt32
	TotalPallets           sql.NullInt32
	WeightLB               sql.NullFloat64
	VolumeCuFT             sql.NullFloat64
	OriginAddress          string
	DestinationAddress     string
	StartDatetime          string
	EndDatetime            string
	Commodity              string
	TenderRequestID        string

	// Manual fields (inherited from last version, not from scrape)
	Rate          sql.NullInt32
	RateInterval  string
	Comments      string
	UserID        sql.NullInt32
	IsHot         bool
	OrderNumber   sql.NullInt32
	FontSize      sql.NullInt32
	IsBold        bool
	StatusUser    sql.NullString
	IsLock        bool

	IsMCC     bool
	CreatedAt time.Time
	UpdatedAt time.Time
}
