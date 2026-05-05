package layout

import (
	"encoding/json"
	"time"
)

type TableLayout struct {
	ID           int              `json:"id"`
	CreatedAt    time.Time        `json:"created_at"`
	UpdatedAt    time.Time        `json:"updated_at"`
	LastEditedBy *int64           `json:"last_edited_by"`
	LastEditedAt *time.Time       `json:"last_edited_at"`
	ColumnWidths json.RawMessage  `json:"column_widths"`
	RowHeights   json.RawMessage  `json:"row_heights"`
}

type LockSession struct {
	ID         int       `json:"id"`
	UserID     int64     `json:"user_id"`
	UserName   string    `json:"user_name"`
	TargetType string    `json:"target_type"`
	TargetName string    `json:"target_name"`
	LockedAt   time.Time `json:"locked_at"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type LockInfo struct {
	UserID    int64     `json:"user_id"`
	UserName  string    `json:"user_name"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ColumnWidthRequest struct {
	Width     int    `json:"width"`
	RequestID string `json:"request_id,omitempty"`
}

type RowHeightRequest struct {
	Height    int    `json:"height"`
	RequestID string `json:"request_id,omitempty"`
}

type LockAcquireRequest struct {
	TargetType string `json:"target_type"`
	TargetName string `json:"target_name"`
}

type LockAcquireResponse struct {
	Success  bool      `json:"success"`
	LockedBy *LockInfo `json:"locked_by,omitempty"`
}

type LockReleaseRequest struct {
	TargetType string `json:"target_type"`
	TargetName string `json:"target_name"`
}
