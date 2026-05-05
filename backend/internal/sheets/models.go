package sheets

import "time"

type CellFormat struct {
	Bg            *string `json:"bg,omitempty"`
	Fg            *string `json:"fg,omitempty"`
	Bold          bool    `json:"bold,omitempty"`
	Italic        bool    `json:"italic,omitempty"`
	Underline     bool    `json:"underline,omitempty"`
	Strikethrough bool    `json:"strikethrough,omitempty"`
	FontSize      *int    `json:"fontSize,omitempty"`
	TextAlign     *string `json:"textAlign,omitempty"`
	VerticalAlign *string `json:"verticalAlign,omitempty"`
}

type RowFormats map[string]CellFormat

type RawLoad struct {
	PickUpDate        string
	Commodity         string
	PickupLocation    string
	DeliveryLocation  string
	AssignedUser      string
	GateCode          string
	Rate              int
	Hot               string
	Notes             string
	IsBold            bool
	IsMCC             bool
	RateMin           int
	RateMax           int
	ParsedPickUpDate  time.Time
	IsGreenRow        bool
	Formats           RowFormats
}
