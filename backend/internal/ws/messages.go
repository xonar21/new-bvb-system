package ws

import "encoding/json"

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func (m Message) Bytes() ([]byte, error) {
	return json.Marshal(m)
}

type PresenceUser struct {
	UserID   int64  `json:"user_id"`
	UserName string `json:"user_name"`
}

type CellFocusPayload struct {
	LoadID   int64  `json:"load_id"`
	Field    string `json:"field"`
	Action   string `json:"action"`
	UserID   int64  `json:"user_id,omitempty"`
	UserName string `json:"user_name,omitempty"`
}

type PresenceList struct {
	Users []PresenceUser `json:"users"`
	Count int            `json:"count"`
}

// FocusSnapshot is sent to newly connected clients so they
// immediately know which cells other users already have focused.
type FocusSnapshot struct {
	Focuses []CellFocusPayload `json:"focuses"`
}

// CellUpdatePayload carries a single cell value/style change via WebSocket.
// The backend broadcasts it instantly to all other clients and writes to DB async.
type CellUpdatePayload struct {
	LoadID   int64  `json:"load_id"`
	Field    string `json:"field"`              // DB column name, e.g. "pick_up_date_col1"
	Value    any    `json:"value,omitempty"`     // new cell value (string, number, bool, or null)
	Style    any    `json:"style,omitempty"`     // optional CellFormat JSON to merge into cell_formats
	UserID   int64  `json:"user_id,omitempty"`
	UserName string `json:"user_name,omitempty"`
}

// CellBulkItem is one entry in a bulk paste operation.
type CellBulkItem struct {
	LoadID int64  `json:"load_id"`
	Field  string `json:"field"`
	Value  any    `json:"value,omitempty"`
}

// CellBulkUpdatePayload carries a batch of cell changes (e.g. TSV paste).
type CellBulkUpdatePayload struct {
	Updates  []CellBulkItem `json:"updates"`
	UserID   int64          `json:"user_id,omitempty"`
	UserName string         `json:"user_name,omitempty"`
}
