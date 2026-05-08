package loads

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) List(ctx context.Context, filters *Filters) ([]Load, error) {
	query := `SELECT id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
		delivery_date_location_col4, assigned_user_col5, gate_code_col6,
		rate_col7, rate_min, rate_max,
		COALESCE(is_bold, false) AS is_bold,
		COALESCE(is_mcc, false)  AS is_mcc,
		COALESCE(is_lock, false) AS is_lock,
		font_size, status, note_mcc, comments, order_number, cell_formats,
		created_at, updated_at
		FROM loads WHERE 1=1`

	var args []interface{}
	argIdx := 1

	if filters.DateFrom != "" {
		query += fmt.Sprintf(" AND pick_up_date_col1 >= $%d", argIdx)
		args = append(args, filters.DateFrom)
		argIdx++
	}
	if filters.DateTo != "" {
		query += fmt.Sprintf(" AND pick_up_date_col1 <= $%d", argIdx)
		args = append(args, filters.DateTo)
		argIdx++
	}
	if filters.Status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, filters.Status)
		argIdx++
	}
	if filters.GateCode != "" {
		query += fmt.Sprintf(" AND gate_code_col6 ILIKE $%d", argIdx)
		args = append(args, "%"+filters.GateCode+"%")
		argIdx++
	}
	if filters.IsMCC == "true" {
		query += " AND is_mcc = true"
	} else if filters.IsMCC == "false" {
		query += " AND is_mcc = false"
	}
	if filters.IsBold == "true" {
		query += " AND is_bold = true"
	} else if filters.IsBold == "false" {
		query += " AND is_bold = false"
	}
	if filters.IsLock == "true" {
		query += " AND is_lock = true"
	} else if filters.IsLock == "false" {
		query += " AND is_lock = false"
	}

	query += " ORDER BY pick_up_date_col1 ASC, order_number ASC NULLS LAST, id ASC"

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query loads: %w", err)
	}
	defer rows.Close()

	var loads []Load
	for rows.Next() {
		var l Load
		err := rows.Scan(
			&l.ID, &l.PickUpDateCol1, &l.CommodityCol2,
			&l.PickupDateLocationCol3, &l.DeliveryDateLocationCol4,
			&l.AssignedUserCol5, &l.GateCodeCol6,
			&l.RateCol7, &l.RateMin, &l.RateMax,
			&l.IsBold, &l.IsMCC, &l.IsLock,
			&l.FontSize, &l.Status, &l.NoteMCC, &l.Comments,
			&l.OrderNumber, &l.CellFormats,
			&l.CreatedAt, &l.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan load: %w", err)
		}
		loads = append(loads, l)
	}

	if loads == nil {
		loads = []Load{}
	}

	return loads, nil
}

func (r *Repository) Get(ctx context.Context, id int64) (*Load, error) {
	query := `SELECT id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
		delivery_date_location_col4, assigned_user_col5, gate_code_col6,
		rate_col7, rate_min, rate_max,
		COALESCE(is_bold, false) AS is_bold,
		COALESCE(is_mcc, false)  AS is_mcc,
		COALESCE(is_lock, false) AS is_lock,
		font_size, status, note_mcc, comments, order_number, cell_formats,
		created_at, updated_at
		FROM loads WHERE id = $1`

	var l Load
	err := r.db.QueryRow(ctx, query, id).Scan(
		&l.ID, &l.PickUpDateCol1, &l.CommodityCol2,
		&l.PickupDateLocationCol3, &l.DeliveryDateLocationCol4,
		&l.AssignedUserCol5, &l.GateCodeCol6,
		&l.RateCol7, &l.RateMin, &l.RateMax,
		&l.IsBold, &l.IsMCC, &l.IsLock,
		&l.FontSize, &l.Status, &l.NoteMCC, &l.Comments,
		&l.OrderNumber, &l.CellFormats,
		&l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get load: %w", err)
	}

	return &l, nil
}

func (r *Repository) Create(ctx context.Context, req CreateRequest) (*Load, error) {
	query := `INSERT INTO loads (
		pick_up_date_col1, commodity_col2, pickup_date_location_col3,
		delivery_date_location_col4, assigned_user_col5, gate_code_col6,
		rate_col7, rate_min, rate_max, is_bold, is_lock,
		font_size, status, comments, order_number,
		created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
	RETURNING id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
		delivery_date_location_col4, assigned_user_col5, gate_code_col6,
		rate_col7, rate_min, rate_max,
		COALESCE(is_bold, false) AS is_bold,
		COALESCE(is_mcc, false)  AS is_mcc,
		COALESCE(is_lock, false) AS is_lock,
		font_size, status, note_mcc, comments, order_number, cell_formats,
		created_at, updated_at`

	var l Load
	err := r.db.QueryRow(ctx, query,
		req.PickUpDateCol1, req.CommodityCol2, req.PickupDateLocationCol3,
		req.DeliveryDateLocationCol4, req.AssignedUserCol5, req.GateCodeCol6,
		req.RateCol7, req.RateMin, req.RateMax,
		req.IsBold, req.IsLock, req.FontSize, req.Status, req.Comments,
		req.OrderNumber,
	).Scan(
		&l.ID, &l.PickUpDateCol1, &l.CommodityCol2,
		&l.PickupDateLocationCol3, &l.DeliveryDateLocationCol4,
		&l.AssignedUserCol5, &l.GateCodeCol6,
		&l.RateCol7, &l.RateMin, &l.RateMax,
		&l.IsBold, &l.IsMCC, &l.IsLock,
		&l.FontSize, &l.Status, &l.NoteMCC, &l.Comments,
		&l.OrderNumber, &l.CellFormats,
		&l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create load: %w", err)
	}

	return &l, nil
}

func (r *Repository) Update(ctx context.Context, id int64, req UpdateRequest) (*Load, error) {
	var sets []string
	var args []interface{}
	argIdx := 1

	addField := func(col string, val interface{}) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, argIdx))
		args = append(args, val)
		argIdx++
	}

	if v, ok := req.PickUpDateCol1.Get(); ok { addField("pick_up_date_col1", v) }
	if v, ok := req.CommodityCol2.Get(); ok { addField("commodity_col2", v) }
	if v, ok := req.PickupDateLocationCol3.Get(); ok { addField("pickup_date_location_col3", v) }
	if v, ok := req.DeliveryDateLocationCol4.Get(); ok { addField("delivery_date_location_col4", v) }
	if v, ok := req.AssignedUserCol5.Get(); ok { addField("assigned_user_col5", v) }
	if v, ok := req.GateCodeCol6.Get(); ok { addField("gate_code_col6", v) }
	if v, ok := req.RateCol7.Get(); ok { addField("rate_col7", v) }
	if v, ok := req.RateMin.Get(); ok { addField("rate_min", v) }
	if v, ok := req.RateMax.Get(); ok { addField("rate_max", v) }
	if v, ok := req.IsBold.Get(); ok {
		if v == nil {
			v = false
		}
		addField("is_bold", v)
	}
	if v, ok := req.IsMCC.Get(); ok {
		if v == nil {
			v = false
		}
		addField("is_mcc", v)
	}
	if v, ok := req.IsLock.Get(); ok {
		if v == nil {
			v = false
		}
		addField("is_lock", v)
	}
	if v, ok := req.FontSize.Get(); ok { addField("font_size", v) }
	if v, ok := req.Status.Get(); ok { addField("status", v) }
	if v, ok := req.NoteMCC.Get(); ok { addField("note_mcc", v) }
	if v, ok := req.Comments.Get(); ok { addField("comments", v) }
	if v, ok := req.OrderNumber.Get(); ok { addField("order_number", v) }
	if req.CellFormats.Set {
		sets = append(sets, fmt.Sprintf("cell_formats = $%d::jsonb", argIdx))
		if req.CellFormats.Value == nil {
			args = append(args, nil)
		} else {
			args = append(args, string(*req.CellFormats.Value))
		}
		argIdx++
	}

	if len(sets) == 0 {
		return r.Get(ctx, id)
	}

	// Protect manual edits from Google Sheets sync unless the caller explicitly sets is_lock.
	if !req.IsLock.Set {
		sets = append(sets, "is_lock = true")
	}

	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)

	query := fmt.Sprintf(`UPDATE loads SET %s WHERE id = $%d
		RETURNING id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
			delivery_date_location_col4, assigned_user_col5, gate_code_col6,
			rate_col7, rate_min, rate_max,
			COALESCE(is_bold, false) AS is_bold,
			COALESCE(is_mcc, false)  AS is_mcc,
			COALESCE(is_lock, false) AS is_lock,
			font_size, status, note_mcc, comments, order_number, cell_formats,
			created_at, updated_at`,
		strings.Join(sets, ", "), argIdx)

	var l Load
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&l.ID, &l.PickUpDateCol1, &l.CommodityCol2,
		&l.PickupDateLocationCol3, &l.DeliveryDateLocationCol4,
		&l.AssignedUserCol5, &l.GateCodeCol6,
		&l.RateCol7, &l.RateMin, &l.RateMax,
		&l.IsBold, &l.IsMCC, &l.IsLock,
		&l.FontSize, &l.Status, &l.NoteMCC, &l.Comments,
		&l.OrderNumber, &l.CellFormats,
		&l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("update load: %w", err)
	}

	return &l, nil
}

func (r *Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, `DELETE FROM loads WHERE id = $1`, id)
	return err
}

func (r *Repository) UpdateCellFormat(ctx context.Context, id int64, column string, format json.RawMessage) (*Load, error) {
	query := `UPDATE loads SET
		cell_formats = jsonb_set(COALESCE(cell_formats, '{}'), $1::text[], $2::jsonb),
		updated_at = NOW()
		WHERE id = $3
		RETURNING id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
			delivery_date_location_col4, assigned_user_col5, gate_code_col6,
			rate_col7, rate_min, rate_max,
			COALESCE(is_bold, false) AS is_bold,
			COALESCE(is_mcc, false)  AS is_mcc,
			COALESCE(is_lock, false) AS is_lock,
			font_size, status, note_mcc, comments, order_number, cell_formats,
			created_at, updated_at`

	var l Load
	err := r.db.QueryRow(ctx, query, []string{column}, format, id).Scan(
		&l.ID, &l.PickUpDateCol1, &l.CommodityCol2,
		&l.PickupDateLocationCol3, &l.DeliveryDateLocationCol4,
		&l.AssignedUserCol5, &l.GateCodeCol6,
		&l.RateCol7, &l.RateMin, &l.RateMax,
		&l.IsBold, &l.IsMCC, &l.IsLock,
		&l.FontSize, &l.Status, &l.NoteMCC, &l.Comments,
		&l.OrderNumber, &l.CellFormats,
		&l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("update cell format: %w", err)
	}

	return &l, nil
}

func (r *Repository) BulkFormat(ctx context.Context, cells []BulkFormatCell) ([]Load, error) {
	type update struct {
		id     int64
		column string
		format json.RawMessage
	}

	// Deduplicate by (id, column)
	seen := make(map[string]bool)
	var updates []update
	for _, cell := range cells {
		key := fmt.Sprintf("%d:%s", cell.LoadID, cell.Column)
		if seen[key] {
			continue
		}
		seen[key] = true
		updates = append(updates, update{id: cell.LoadID, column: cell.Column, format: cell.Format})
	}

	batch := &pgx.Batch{}
	for _, u := range updates {
		batch.Queue(`UPDATE loads SET
			cell_formats = jsonb_set(COALESCE(cell_formats, '{}'), $1::text[], $2::jsonb),
			updated_at = NOW()
			WHERE id = $3
			RETURNING id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
				delivery_date_location_col4, assigned_user_col5, gate_code_col6,
				rate_col7, rate_min, rate_max,
				COALESCE(is_bold, false) AS is_bold,
				COALESCE(is_mcc, false)  AS is_mcc,
				COALESCE(is_lock, false) AS is_lock,
				font_size, status, note_mcc, comments, order_number, cell_formats,
				created_at, updated_at`,
			[]string{u.column}, string(u.format), u.id)
	}

	results := r.db.SendBatch(ctx, batch)
	defer results.Close()

	loadMap := make(map[int64]*Load)
	for i := 0; i < batch.Len(); i++ {
		var l Load
		if err := results.QueryRow().Scan(
			&l.ID, &l.PickUpDateCol1, &l.CommodityCol2,
			&l.PickupDateLocationCol3, &l.DeliveryDateLocationCol4,
			&l.AssignedUserCol5, &l.GateCodeCol6,
			&l.RateCol7, &l.RateMin, &l.RateMax,
			&l.IsBold, &l.IsMCC, &l.IsLock,
			&l.FontSize, &l.Status, &l.NoteMCC, &l.Comments,
			&l.OrderNumber, &l.CellFormats,
			&l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("bulk format scan: %w", err)
		}
		loadMap[l.ID] = &l
	}

	if err := results.Close(); err != nil {
		return nil, fmt.Errorf("bulk format close: %w", err)
	}

	result := make([]Load, 0, len(loadMap))
	for _, l := range loadMap {
		result = append(result, *l)
	}

	return result, nil
}

// validCellFields is the allowlist for WS-driven cell writes (prevents SQL injection).
var validCellFields = map[string]bool{
	"pick_up_date_col1":           true,
	"commodity_col2":              true,
	"pickup_date_location_col3":   true,
	"delivery_date_location_col4": true,
	"assigned_user_col5":          true,
	"gate_code_col6":              true,
	"rate_col7":                   true,
	"rate_min":                    true,
	"rate_max":                    true,
	"is_bold":                     true,
	"is_mcc":                      true,
	"is_lock":                     true,
	"font_size":                   true,
	"status":                      true,
	"note_mcc":                    true,
	"comments":                    true,
	"order_number":                true,
}

// UpdateCellField updates a single named column in the loads table.
// Implements ws.CellWriter. The field name is validated against the allowlist.
func (r *Repository) UpdateCellField(ctx context.Context, loadID int64, field string, value any) error {
	if !validCellFields[field] {
		return fmt.Errorf("UpdateCellField: invalid field %q", field)
	}
	// Any manual edit should protect the row from being overwritten by Google Sheets sync.
	// Exception: toggling is_lock itself should not force re-lock.
	query := fmt.Sprintf(`UPDATE loads SET %s = $1, updated_at = NOW() WHERE id = $2`, field)
	args := []any{value, loadID}
	if field != "is_lock" {
		query = fmt.Sprintf(`UPDATE loads SET %s = $1, is_lock = true, updated_at = NOW() WHERE id = $2`, field)
	}

	_, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("UpdateCellField (load=%d field=%s): %w", loadID, field, err)
	}
	return nil
}

// UpdateCellStyle merges a style object into the cell_formats JSONB for the given field key.
// Implements ws.CellWriter. Uses jsonb_set so other fields in cell_formats are preserved.
func (r *Repository) UpdateCellStyle(ctx context.Context, loadID int64, field string, style any) error {
	styleJSON, err := json.Marshal(style)
	if err != nil {
		return fmt.Errorf("UpdateCellStyle marshal: %w", err)
	}
	_, err = r.db.Exec(ctx,
		`UPDATE loads
		 SET cell_formats = jsonb_set(COALESCE(cell_formats, '{}'::jsonb), $1::text[], $2::jsonb, true),
		     is_lock = true,
		     updated_at = NOW()
		 WHERE id = $3`,
		[]string{field}, json.RawMessage(styleJSON), loadID,
	)
	if err != nil {
		return fmt.Errorf("UpdateCellStyle (load=%d field=%s): %w", loadID, field, err)
	}
	return nil
}

func (r *Repository) BulkOrder(ctx context.Context, items []BulkOrderItem) error {
	batch := &pgx.Batch{}
	for _, item := range items {
		batch.Queue(`UPDATE loads SET order_number = $1, updated_at = NOW() WHERE id = $2`,
			item.OrderNumber, item.ID)
	}

	results := r.db.SendBatch(ctx, batch)
	defer results.Close()

	for i := 0; i < batch.Len(); i++ {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("bulk order item %d: %w", i, err)
		}
	}

	return results.Close()
}
