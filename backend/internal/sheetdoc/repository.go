package sheetdoc

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// periodicVersionInterval throttles "auto" version snapshots during normal
// editing so we don't create a version on every debounced save, while still
// capturing the edit history at a fine enough granularity to see who changed
// what over time.
const periodicVersionInterval = 30 * time.Second

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Get returns the single global sheet document (id = 1), or nil if missing.
func (r *Repository) Get(ctx context.Context) (*SheetDocument, error) {
	query := `SELECT id, name, data, updated_at, last_edited_by
		FROM sheet_documents WHERE id = 1`

	var d SheetDocument
	err := r.db.QueryRow(ctx, query).Scan(&d.ID, &d.Name, &d.Data, &d.UpdatedAt, &d.LastEditedBy)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get sheet document: %w", err)
	}
	return &d, nil
}

// GetByID returns a sheet document by ID
func (r *Repository) GetByID(ctx context.Context, id int) (*SheetDocument, error) {
	query := `SELECT id, name, data, updated_at, last_edited_by
		FROM sheet_documents WHERE id = $1`

	var d SheetDocument
	err := r.db.QueryRow(ctx, query, id).Scan(&d.ID, &d.Name, &d.Data, &d.UpdatedAt, &d.LastEditedBy)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get sheet document by id: %w", err)
	}
	return &d, nil
}

// Update updates the sheet document data
func (r *Repository) Update(ctx context.Context, id int, data json.RawMessage) error {
	if len(data) == 0 {
		data = json.RawMessage("{}")
	}
	_, err := r.db.Exec(ctx,
		`UPDATE sheet_documents SET data = $1, updated_at = NOW() WHERE id = $2`,
		data, id)
	if err != nil {
		return fmt.Errorf("update sheet document: %w", err)
	}
	return nil
}

// Save upserts the single global sheet document with the full workbook snapshot.
// When reason == "manual" a version is always recorded; otherwise an "auto"
// version is only recorded if the last version is older than the throttle window.
func (r *Repository) Save(ctx context.Context, name string, data json.RawMessage, reason string, userID int64, userEmail string) error {
	if len(data) == 0 {
		data = json.RawMessage("{}")
	}
	if name == "" {
		name = "Loads"
	}

	// Capture the previous document so we can log per-cell changes (old → new).
	var oldData json.RawMessage
	_ = r.db.QueryRow(ctx, `SELECT data FROM sheet_documents WHERE id = 1`).Scan(&oldData)

	_, err := r.db.Exec(ctx, `
		INSERT INTO sheet_documents (id, name, data, updated_at, last_edited_by)
		VALUES (1, $1, $2, NOW(), $3)
		ON CONFLICT (id) DO UPDATE
			SET name = EXCLUDED.name,
			    data = EXCLUDED.data,
			    updated_at = NOW(),
			    last_edited_by = EXCLUDED.last_edited_by`,
		name, data, userID)
	if err != nil {
		return fmt.Errorf("save sheet document: %w", err)
	}

	// Calculate semantic diff: only cells that actually changed (not binary comparison).
	changes := diffCells(oldData, data)

	// Best-effort: record cell-level changes for the history view.
	if len(changes) > 0 {
		r.insertCellChanges(ctx, changes, userID, userEmail)
	}

	// Skip no-op versions: if no cells changed, don't create a version.
	// This prevents clutter from auto-saves with no actual modifications.
	if len(changes) == 0 {
		return nil
	}

	if reason == "manual" {
		return r.insertVersion(ctx, name, data, "manual", userID, userEmail)
	}

	// Periodic auto-version (throttled).
	var last time.Time
	err = r.db.QueryRow(ctx, `SELECT COALESCE(MAX(created_at), 'epoch') FROM sheet_versions`).Scan(&last)
	if err != nil {
		return nil // saving succeeded; versioning is best-effort
	}
	if time.Since(last) >= periodicVersionInterval {
		_ = r.insertVersion(ctx, name, data, "auto", userID, userEmail)
	}
	return nil
}

// SaveDeleteEvent records the deletion atomically: keep the "before" snapshot,
// write the new "after" state as current, keep the "after" snapshot, and log
// who deleted what.
func (r *Repository) SaveDeleteEvent(ctx context.Context, req DeleteEventRequest, userID int64, userEmail string) error {
	name := req.Name
	if name == "" {
		name = "Loads"
	}
	before := req.Before
	if len(before) == 0 {
		before = json.RawMessage("{}")
	}
	after := req.After
	if len(after) == 0 {
		after = json.RawMessage("{}")
	}
	details := req.Details
	if len(details) == 0 {
		details = json.RawMessage("{}")
	}

	// Skip no-op deletes: if no cells changed, nothing actually was deleted.
	// This prevents logging spurious deletes (e.g., Ctrl+A + Delete with no content).
	if len(diffCells(before, after)) == 0 {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin delete tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1) version: state BEFORE the deletion
	var beforeID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO sheet_versions (name, data, reason, created_by, created_by_email)
		 VALUES ($1, $2, 'before_delete', $3, $4) RETURNING id`,
		name, before, userID, userEmail).Scan(&beforeID); err != nil {
		return fmt.Errorf("insert before_delete version: %w", err)
	}

	// 2) current document = AFTER
	if _, err := tx.Exec(ctx,
		`INSERT INTO sheet_documents (id, name, data, updated_at, last_edited_by)
		 VALUES (1, $1, $2, NOW(), $3)
		 ON CONFLICT (id) DO UPDATE
		   SET name = EXCLUDED.name, data = EXCLUDED.data,
		       updated_at = NOW(), last_edited_by = EXCLUDED.last_edited_by`,
		name, after, userID); err != nil {
		return fmt.Errorf("update current after delete: %w", err)
	}

	// 3) version: state AFTER the deletion
	var afterID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO sheet_versions (name, data, reason, created_by, created_by_email)
		 VALUES ($1, $2, 'after_delete', $3, $4) RETURNING id`,
		name, after, userID, userEmail).Scan(&afterID); err != nil {
		return fmt.Errorf("insert after_delete version: %w", err)
	}

	// 4) audit log — links to the before/after snapshots for the preview modal.
	action := req.Action
	if action == "" {
		action = "clear_cells"
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO sheet_audit_log (user_id, user_email, action, details, before_version_id, after_version_id)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, userEmail, action, details, beforeID, afterID); err != nil {
		return fmt.Errorf("insert audit: %w", err)
	}

	return tx.Commit(ctx)
}

func (r *Repository) insertVersion(ctx context.Context, name string, data json.RawMessage, reason string, userID int64, userEmail string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO sheet_versions (name, data, reason, created_by, created_by_email)
		 VALUES ($1, $2, $3, $4, $5)`,
		name, data, reason, userID, userEmail)
	if err != nil {
		return fmt.Errorf("insert version: %w", err)
	}
	return nil
}

// CreateVersion records a version snapshot
func (r *Repository) CreateVersion(ctx context.Context, docID int, data json.RawMessage, reason string, userID *int64, userEmail string) error {
	var uid interface{}
	if userID != nil {
		uid = *userID
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO sheet_versions (name, data, reason, created_by, created_by_email)
		 VALUES ('Loads', $1, $2, $3, $4)`,
		data, reason, uid, userEmail)
	if err != nil {
		return fmt.Errorf("create version: %w", err)
	}
	return nil
}

// ListVersions returns version metadata (without the heavy data blob).
func (r *Repository) ListVersions(ctx context.Context, limit int) ([]SheetVersion, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx,
		`SELECT id, name, reason, created_by, COALESCE(created_by_email, ''), created_at
		 FROM sheet_versions ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()

	out := make([]SheetVersion, 0)
	for rows.Next() {
		var v SheetVersion
		if err := rows.Scan(&v.ID, &v.Name, &v.Reason, &v.CreatedBy, &v.CreatedByEmail, &v.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan version: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVersion returns a single version including its full data blob.
func (r *Repository) GetVersion(ctx context.Context, id int64) (*SheetVersion, error) {
	var v SheetVersion
	err := r.db.QueryRow(ctx,
		`SELECT id, name, data, reason, created_by, COALESCE(created_by_email, ''), created_at
		 FROM sheet_versions WHERE id = $1`, id).
		Scan(&v.ID, &v.Name, &v.Data, &v.Reason, &v.CreatedBy, &v.CreatedByEmail, &v.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get version: %w", err)
	}
	return &v, nil
}

// Restore sets the current document to the given version's content and records
// the action (a "restore" version + an audit entry).
func (r *Repository) Restore(ctx context.Context, versionID int64, userID int64, userEmail string) (*SheetVersion, error) {
	v, err := r.GetVersion(ctx, versionID)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin restore tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO sheet_documents (id, name, data, updated_at, last_edited_by)
		 VALUES (1, $1, $2, NOW(), $3)
		 ON CONFLICT (id) DO UPDATE
		   SET name = EXCLUDED.name, data = EXCLUDED.data,
		       updated_at = NOW(), last_edited_by = EXCLUDED.last_edited_by`,
		v.Name, v.Data, userID); err != nil {
		return nil, fmt.Errorf("restore current: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO sheet_versions (name, data, reason, created_by, created_by_email)
		 VALUES ($1, $2, 'restore', $3, $4)`,
		v.Name, v.Data, userID, userEmail); err != nil {
		return nil, fmt.Errorf("insert restore version: %w", err)
	}

	details, _ := json.Marshal(map[string]any{"restored_version_id": versionID})
	if _, err := tx.Exec(ctx,
		`INSERT INTO sheet_audit_log (user_id, user_email, action, details)
		 VALUES ($1, $2, 'restore', $3)`,
		userID, userEmail, details); err != nil {
		return nil, fmt.Errorf("insert restore audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return v, nil
}

// insertCellChanges records per-cell changes to the database.
// Best-effort: errors are swallowed so they never block a save.
// Caller is responsible for checking len(changes) > 0 before calling.
func (r *Repository) insertCellChanges(ctx context.Context, changes []CellChange, userID int64, userEmail string) {
	// Cap to avoid flooding on a large paste/import.
	if len(changes) > 2000 {
		changes = changes[:2000]
	}
	batch := &pgx.Batch{}
	for _, ch := range changes {
		batch.Queue(
			`INSERT INTO sheet_cell_changes (user_id, user_email, row_idx, col_idx, old_value, new_value)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			userID, userEmail, ch.RowIdx, ch.ColIdx, ch.OldValue, ch.NewValue)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for range changes {
		_, _ = br.Exec()
	}
}

// ListCellChanges returns the cell-level change log, newest first.
func (r *Repository) ListCellChanges(ctx context.Context, limit int) ([]CellChange, error) {
	if limit <= 0 || limit > 1000 {
		limit = 300
	}
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, COALESCE(user_email, ''), row_idx, col_idx,
		        COALESCE(old_value, ''), COALESCE(new_value, ''), created_at
		 FROM sheet_cell_changes ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list cell changes: %w", err)
	}
	defer rows.Close()

	out := make([]CellChange, 0)
	for rows.Next() {
		var c CellChange
		if err := rows.Scan(&c.ID, &c.UserID, &c.UserEmail, &c.RowIdx, &c.ColIdx, &c.OldValue, &c.NewValue, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan cell change: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListAudit returns the audit log, newest first.
func (r *Repository) ListAudit(ctx context.Context, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, COALESCE(user_email, ''), action, details, before_version_id, after_version_id, created_at
		 FROM sheet_audit_log ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list audit: %w", err)
	}
	defer rows.Close()

	out := make([]AuditEntry, 0)
	for rows.Next() {
		var a AuditEntry
		if err := rows.Scan(&a.ID, &a.UserID, &a.UserEmail, &a.Action, &a.Details, &a.BeforeVersionID, &a.AfterVersionID, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan audit: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
