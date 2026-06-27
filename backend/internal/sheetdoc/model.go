package sheetdoc

import (
	"encoding/json"
	"time"
)

// SheetDocument is the full Fortune Sheet workbook snapshot stored as a single
// global row (id = 1). `Data` holds the entire workbook JSON (cells, styles,
// config, merges, etc.) so the whole sheet can be restored verbatim.
type SheetDocument struct {
	ID           int64           `json:"id"`
	Name         string          `json:"name"`
	Data         json.RawMessage `json:"data"`
	UpdatedAt    time.Time       `json:"updated_at"`
	LastEditedBy *int64          `json:"last_edited_by"`
}

// SaveRequest is the payload for PUT /api/sheet.
type SaveRequest struct {
	Name   string          `json:"name"`
	Data   json.RawMessage `json:"data"`
	Reason string          `json:"reason"` // "auto" (default) | "manual"
}

// DeleteEventRequest is sent when the user deletes rows/cols/cells. It carries
// the FULL state before and after the deletion so we can keep both versions,
// plus an audit description of what was removed.
type DeleteEventRequest struct {
	Name    string          `json:"name"`
	Before  json.RawMessage `json:"before"`
	After   json.RawMessage `json:"after"`
	Action  string          `json:"action"`  // delete_rows | delete_cols | clear_cells
	Details json.RawMessage `json:"details"` // arbitrary JSON describing what was removed
}

// SheetVersion is a stored historical snapshot.
type SheetVersion struct {
	ID             int64           `json:"id"`
	Name           string          `json:"name"`
	Data           json.RawMessage `json:"data,omitempty"`
	Reason         string          `json:"reason"`
	CreatedBy      *int64          `json:"created_by"`
	CreatedByEmail string          `json:"created_by_email"`
	CreatedAt      time.Time       `json:"created_at"`
}

// AuditEntry is a single audit-log record.
type AuditEntry struct {
	ID              int64           `json:"id"`
	UserID          *int64          `json:"user_id"`
	UserEmail       string          `json:"user_email"`
	Action          string          `json:"action"`
	Details         json.RawMessage `json:"details"`
	BeforeVersionID *int64          `json:"before_version_id"`
	AfterVersionID  *int64          `json:"after_version_id"`
	CreatedAt       time.Time       `json:"created_at"`
}

// CellChange is a single cell-level edit: which cell, who, old → new value.
type CellChange struct {
	ID        int64     `json:"id"`
	UserID    *int64    `json:"user_id"`
	UserEmail string    `json:"user_email"`
	RowIdx    int       `json:"row_idx"`
	ColIdx    int       `json:"col_idx"`
	OldValue  string    `json:"old_value"`
	NewValue  string    `json:"new_value"`
	CreatedAt time.Time `json:"created_at"`
}
