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
		rate_col7, rate_min, rate_max, is_bold, is_mcc, is_lock,
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
		rate_col7, rate_min, rate_max, is_bold, is_mcc, is_lock,
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

func (r *Repository) Create(ctx context.Context, req UpdateRequest) (*Load, error) {
	query := `INSERT INTO loads (
		pick_up_date_col1, commodity_col2, pickup_date_location_col3,
		delivery_date_location_col4, assigned_user_col5, gate_code_col6,
		rate_col7, rate_min, rate_max, is_bold, is_lock,
		font_size, status, comments, order_number,
		created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
	RETURNING id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
		delivery_date_location_col4, assigned_user_col5, gate_code_col6,
		rate_col7, rate_min, rate_max, is_bold, is_mcc, is_lock,
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

	if req.PickUpDateCol1 != nil { addField("pick_up_date_col1", *req.PickUpDateCol1) }
	if req.CommodityCol2 != nil { addField("commodity_col2", *req.CommodityCol2) }
	if req.PickupDateLocationCol3 != nil { addField("pickup_date_location_col3", *req.PickupDateLocationCol3) }
	if req.DeliveryDateLocationCol4 != nil { addField("delivery_date_location_col4", *req.DeliveryDateLocationCol4) }
	if req.AssignedUserCol5 != nil { addField("assigned_user_col5", *req.AssignedUserCol5) }
	if req.RateCol7 != nil { addField("rate_col7", *req.RateCol7) }
	if req.RateMin != nil { addField("rate_min", *req.RateMin) }
	if req.RateMax != nil { addField("rate_max", *req.RateMax) }
	if req.IsBold != nil { addField("is_bold", *req.IsBold) }
	if req.IsLock != nil { addField("is_lock", *req.IsLock) }
	if req.FontSize != nil { addField("font_size", *req.FontSize) }
	if req.Status != nil { addField("status", *req.Status) }
	if req.Comments != nil { addField("comments", *req.Comments) }
	if req.OrderNumber != nil { addField("order_number", *req.OrderNumber) }
	if req.CellFormats != nil {
		sets = append(sets, fmt.Sprintf("cell_formats = $%d::jsonb", argIdx))
		args = append(args, string(*req.CellFormats))
		argIdx++
	}

	if len(sets) == 0 {
		return r.Get(ctx, id)
	}

	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)

	query := fmt.Sprintf(`UPDATE loads SET %s WHERE id = $%d
		RETURNING id, pick_up_date_col1, commodity_col2, pickup_date_location_col3,
			delivery_date_location_col4, assigned_user_col5, gate_code_col6,
			rate_col7, rate_min, rate_max, is_bold, is_mcc, is_lock,
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
			rate_col7, rate_min, rate_max, is_bold, is_mcc, is_lock,
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
