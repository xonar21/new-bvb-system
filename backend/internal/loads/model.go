package loads

import (
	"encoding/json"
	"time"
)

type Load struct {
	ID                       int64           `json:"id"`
	PickUpDateCol1           *time.Time      `json:"pick_up_date_col1"`
	CommodityCol2            *string         `json:"commodity_col2"`
	PickupDateLocationCol3   *string         `json:"pickup_date_location_col3"`
	DeliveryDateLocationCol4 *string         `json:"delivery_date_location_col4"`
	AssignedUserCol5         *string         `json:"assigned_user_col5"`
	GateCodeCol6             string          `json:"gate_code_col6"`
	RateCol7                 *int            `json:"rate_col7"`
	RateMin                  *int            `json:"rate_min"`
	RateMax                  *int            `json:"rate_max"`
	IsBold                   bool            `json:"is_bold"`
	IsMCC                    bool            `json:"is_mcc"`
	IsLock                   bool            `json:"is_lock"`
	FontSize                 *int            `json:"font_size"`
	Status                   *string         `json:"status"`
	NoteMCC                  *string         `json:"note_mcc"`
	Comments                 *string         `json:"comments"`
	OrderNumber              *int            `json:"order_number"`
	CellFormats              json.RawMessage `json:"cell_formats"`
	CreatedAt                time.Time       `json:"created_at"`
	UpdatedAt                time.Time       `json:"updated_at"`
}

type Filters struct {
	DateFrom string `json:"date_from"`
	DateTo   string `json:"date_to"`
	Status   string `json:"status"`
	GateCode string `json:"gate_code"`
	IsMCC    string `json:"is_mcc"`
	IsBold   string `json:"is_bold"`
	IsLock   string `json:"is_lock"`
}

type UpdateRequest struct {
	PickUpDateCol1           *string          `json:"pick_up_date_col1"`
	CommodityCol2            *string          `json:"commodity_col2"`
	PickupDateLocationCol3   *string          `json:"pickup_date_location_col3"`
	DeliveryDateLocationCol4 *string          `json:"delivery_date_location_col4"`
	AssignedUserCol5         *string          `json:"assigned_user_col5"`
	GateCodeCol6             *string          `json:"gate_code_col6"`
	RateCol7                 *int             `json:"rate_col7"`
	RateMin                  *int             `json:"rate_min"`
	RateMax                  *int             `json:"rate_max"`
	IsBold                   *bool            `json:"is_bold"`
	IsLock                   *bool            `json:"is_lock"`
	FontSize                 *int             `json:"font_size"`
	Status                   *string          `json:"status"`
	Comments                 *string          `json:"comments"`
	OrderNumber              *int             `json:"order_number"`
	CellFormats              *json.RawMessage `json:"cell_formats"`
}

type FormatRequest struct {
	Column string          `json:"column"`
	Format json.RawMessage `json:"format"`
}

type BulkOrderItem struct {
	ID          int64 `json:"id"`
	OrderNumber int   `json:"order_number"`
}

type BulkOrderRequest struct {
	Items []BulkOrderItem `json:"items"`
}

type LoadsResponse struct {
	Loads []Load `json:"loads"`
}
