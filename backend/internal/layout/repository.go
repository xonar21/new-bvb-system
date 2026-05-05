package layout

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) GetLayout(ctx context.Context) (*TableLayout, error) {
	query := `SELECT id, created_at, updated_at, last_edited_by, last_edited_at,
		column_widths, row_heights FROM table_layouts WHERE id = 1`

	var tl TableLayout
	err := r.db.QueryRow(ctx, query).Scan(
		&tl.ID, &tl.CreatedAt, &tl.UpdatedAt,
		&tl.LastEditedBy, &tl.LastEditedAt,
		&tl.ColumnWidths, &tl.RowHeights,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get layout: %w", err)
	}
	return &tl, nil
}

func (r *Repository) GetActiveLocks(ctx context.Context) ([]LockSession, error) {
	query := `SELECT les.id, les.user_id, COALESCE(u.name, ''), les.target_type, les.target_name,
		les.locked_at, les.expires_at
		FROM layout_edit_sessions les
		LEFT JOIN users u ON u.id = les.user_id
		WHERE les.expires_at > NOW()`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get active locks: %w", err)
	}
	defer rows.Close()

	var sessions []LockSession
	for rows.Next() {
		var s LockSession
		if err := rows.Scan(&s.ID, &s.UserID, &s.UserName, &s.TargetType, &s.TargetName,
			&s.LockedAt, &s.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan lock session: %w", err)
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []LockSession{}
	}
	return sessions, nil
}

func (r *Repository) acquireOrRenewLockTx(ctx context.Context, tx pgx.Tx, targetType, targetName string, userID int64) (*LockInfo, error) {
	var existingUserID int64
	var existingExpiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT user_id, expires_at FROM layout_edit_sessions
		 WHERE target_type = $1 AND target_name = $2 AND expires_at > NOW()`,
		targetType, targetName).Scan(&existingUserID, &existingExpiresAt)

	if err == nil && existingUserID != userID {
		var userName string
		tx.QueryRow(ctx, `SELECT COALESCE(name, '') FROM users WHERE id = $1`, existingUserID).Scan(&userName)
		return &LockInfo{
			UserID:    existingUserID,
			UserName:  userName,
			ExpiresAt: existingExpiresAt,
		}, nil
	}

	if err == nil && existingUserID == userID {
		_, err = tx.Exec(ctx,
			`UPDATE layout_edit_sessions SET expires_at = NOW() + INTERVAL '30 seconds', locked_at = NOW()
			 WHERE target_type = $1 AND target_name = $2 AND user_id = $3`,
			targetType, targetName, userID)
	} else {
		_, err = tx.Exec(ctx,
			`INSERT INTO layout_edit_sessions (user_id, target_type, target_name, expires_at)
			 VALUES ($1, $2, $3, NOW() + INTERVAL '30 seconds')`,
			userID, targetType, targetName)
	}
	if err != nil {
		return nil, fmt.Errorf("upsert lock: %w", err)
	}
	return nil, nil
}

func (r *Repository) UpdateColumnWidth(ctx context.Context, columnName string, width int, userID int64) (*LockInfo, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	conflict, err := r.acquireOrRenewLockTx(ctx, tx, "column", columnName, userID)
	if err != nil {
		return nil, err
	}
	if conflict != nil {
		return conflict, nil
	}

	_, err = tx.Exec(ctx,
		`UPDATE table_layouts SET
			column_widths = jsonb_set(COALESCE(column_widths, '{}'::jsonb), $1::text[], $2::jsonb),
			updated_at = NOW(),
			last_edited_by = $3,
			last_edited_at = NOW()
		 WHERE id = 1`,
		[]string{columnName}, fmt.Sprintf(`%d`, width), userID)
	if err != nil {
		return nil, fmt.Errorf("update column width: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}
	return nil, nil
}

func (r *Repository) UpdateRowHeight(ctx context.Context, rowIndex string, height int, userID int64) (*LockInfo, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	conflict, err := r.acquireOrRenewLockTx(ctx, tx, "row", rowIndex, userID)
	if err != nil {
		return nil, err
	}
	if conflict != nil {
		return conflict, nil
	}

	_, err = tx.Exec(ctx,
		`UPDATE table_layouts SET
			row_heights = jsonb_set(COALESCE(row_heights, '{}'::jsonb), $1::text[], $2::jsonb),
			updated_at = NOW(),
			last_edited_by = $3,
			last_edited_at = NOW()
		 WHERE id = 1`,
		[]string{rowIndex}, fmt.Sprintf(`%d`, height), userID)
	if err != nil {
		return nil, fmt.Errorf("update row height: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}
	return nil, nil
}

func (r *Repository) AcquireLock(ctx context.Context, targetType, targetName string, userID int64) (*LockAcquireResponse, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx,
		`DELETE FROM layout_edit_sessions
		 WHERE target_type = $1 AND target_name = $2 AND expires_at <= NOW()`,
		targetType, targetName)
	if err != nil {
		return nil, fmt.Errorf("clean expired: %w", err)
	}

	conflict, err := r.acquireOrRenewLockTx(ctx, tx, targetType, targetName, userID)
	if err != nil {
		return nil, err
	}
	if conflict != nil {
		return &LockAcquireResponse{Success: false, LockedBy: conflict}, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}
	return &LockAcquireResponse{Success: true}, nil
}

func (r *Repository) ReleaseLock(ctx context.Context, targetType, targetName string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM layout_edit_sessions WHERE target_type = $1 AND target_name = $2`,
		targetType, targetName)
	return err
}

func (r *Repository) CleanupExpiredLocks(ctx context.Context) ([]LockSession, error) {
	rows, err := r.db.Query(ctx,
		`SELECT les.id, les.user_id, COALESCE(u.name, ''), les.target_type, les.target_name,
			les.locked_at, les.expires_at
		 FROM layout_edit_sessions les
		 LEFT JOIN users u ON u.id = les.user_id
		 WHERE les.expires_at <= NOW()`)
	if err != nil {
		return nil, fmt.Errorf("query expired locks: %w", err)
	}
	defer rows.Close()

	var expired []LockSession
	for rows.Next() {
		var s LockSession
		if err := rows.Scan(&s.ID, &s.UserID, &s.UserName, &s.TargetType, &s.TargetName,
			&s.LockedAt, &s.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan expired: %w", err)
		}
		expired = append(expired, s)
	}

	if len(expired) > 0 {
		_, err = r.db.Exec(ctx, `DELETE FROM layout_edit_sessions WHERE expires_at <= NOW()`)
		if err != nil {
			return nil, fmt.Errorf("delete expired: %w", err)
		}
	}

	if expired == nil {
		expired = []LockSession{}
	}
	return expired, nil
}

func (r *Repository) ResetLayout(ctx context.Context) error {
	_, err := r.db.Exec(ctx,
		`UPDATE table_layouts SET
			column_widths = '{}'::jsonb,
			row_heights = '{}'::jsonb,
			updated_at = NOW(),
			last_edited_by = NULL,
			last_edited_at = NOW()
		 WHERE id = 1`)
	if err != nil {
		return fmt.Errorf("reset layout: %w", err)
	}

	_, err = r.db.Exec(ctx, `DELETE FROM layout_edit_sessions`)
	if err != nil {
		return fmt.Errorf("reset locks: %w", err)
	}
	return nil
}

func (r *Repository) GetColumnWidths(ctx context.Context) (map[string]int, error) {
	var raw json.RawMessage
	err := r.db.QueryRow(ctx, `SELECT column_widths FROM table_layouts WHERE id = 1`).Scan(&raw)
	if err != nil {
		if err == pgx.ErrNoRows {
			return make(map[string]int), nil
		}
		return nil, fmt.Errorf("get column widths: %w", err)
	}
	result := make(map[string]int)
	if len(raw) > 0 && string(raw) != "null" {
		json.Unmarshal(raw, &result)
	}
	if result == nil {
		result = make(map[string]int)
	}
	return result, nil
}
