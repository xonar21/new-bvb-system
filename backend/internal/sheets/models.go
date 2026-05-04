package sheets

import "time"

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
}
