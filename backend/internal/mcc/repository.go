package mcc

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles MCC shipment persistence
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository creates a new MCC repository
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// GetLastByTrackingNumber retrieves the latest version of a shipment
func (r *Repository) GetLastByTrackingNumber(ctx context.Context, trackingNumber string) (*MccShipment, error) {
	query := `
		SELECT id, row_key, load_id, load_tracking_number, response_required_by_date,
		       total_distance_miles, stops_in_transit, service, trailer_equipment_type,
		       total_cost_usd, total_pieces, total_pallets, weight_lb, volume_cuft,
		       origin_address, destination_address, start_datetime, end_datetime,
		       commodity, tender_request_id,
		       rate, rate_interval, comments, user_id, is_hot, order_number, font_size,
		       is_bold, status_user, is_lock, is_mcc, created_at, updated_at
		FROM mcc_shipments
		WHERE load_tracking_number = $1
		ORDER BY created_at DESC
		LIMIT 1
	`

	var shipment MccShipment
	err := r.db.QueryRow(ctx, query, trackingNumber).Scan(
		&shipment.ID, &shipment.RowKey, &shipment.LoadID, &shipment.LoadTrackingNumber,
		&shipment.ResponseRequiredByDate, &shipment.TotalDistanceMiles, &shipment.StopsInTransit,
		&shipment.Service, &shipment.TrailerEquipmentType, &shipment.TotalCostUSD,
		&shipment.TotalPieces, &shipment.TotalPallets, &shipment.WeightLB, &shipment.VolumeCuFT,
		&shipment.OriginAddress, &shipment.DestinationAddress, &shipment.StartDatetime,
		&shipment.EndDatetime, &shipment.Commodity, &shipment.TenderRequestID,
		&shipment.Rate, &shipment.RateInterval, &shipment.Comments, &shipment.UserID,
		&shipment.IsHot, &shipment.OrderNumber, &shipment.FontSize, &shipment.IsBold,
		&shipment.StatusUser, &shipment.IsLock, &shipment.IsMCC, &shipment.CreatedAt,
		&shipment.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &shipment, nil
}

// Upsert inserts a new version of a shipment (preserving manual fields)
func (r *Repository) Upsert(ctx context.Context, raw *RawMccShipment, last *MccShipment) (*MccShipment, error) {
	// Normalize numeric fields
	totalDistanceMiles := parseFloat(raw.TotalDistanceMiles)
	stopsInTransit := parseInt32(raw.StopsInTransit)
	totalCostUSD := parseFloat(raw.TotalCostUSD)
	totalPieces := parseInt32(raw.TotalPieces)
	totalPallets := parseInt32(raw.TotalPallets)
	weightLB := parseFloat(raw.WeightLB)
	volumeCuFT := parseFloat(raw.VolumeCuFT)

	shipment := &MccShipment{
		RowKey:                 raw.RowKey,
		LoadID:                 raw.LoadID,
		LoadTrackingNumber:     raw.LoadTrackingNumber,
		ResponseRequiredByDate: raw.ResponseRequiredByDate,
		TotalDistanceMiles:     totalDistanceMiles,
		StopsInTransit:         stopsInTransit,
		Service:                raw.Service,
		TrailerEquipmentType:   raw.TrailerEquipmentType,
		TotalCostUSD:           totalCostUSD,
		TotalPieces:            totalPieces,
		TotalPallets:           totalPallets,
		WeightLB:               weightLB,
		VolumeCuFT:             volumeCuFT,
		OriginAddress:          raw.OriginAddress,
		DestinationAddress:     raw.DestinationAddress,
		StartDatetime:          raw.StartDatetime,
		EndDatetime:            raw.EndDatetime,
		Commodity:              raw.Commodity,
		TenderRequestID:        raw.TenderRequestID,
		IsMCC:                  true,
	}

	// Inherit manual fields from last version
	if last != nil {
		shipment.Rate = last.Rate
		shipment.RateInterval = last.RateInterval
		shipment.Comments = last.Comments
		shipment.UserID = last.UserID
		shipment.IsHot = last.IsHot
		shipment.OrderNumber = last.OrderNumber
		shipment.FontSize = last.FontSize
		shipment.IsBold = last.IsBold
		shipment.IsLock = last.IsLock

		// Reset status_user if pickup date changed
		lastPickupDate := extractDate(last.StartDatetime)
		currentPickupDate := extractDate(raw.StartDatetime)
		if lastPickupDate != currentPickupDate {
			shipment.StatusUser = sql.NullString{}
		} else {
			shipment.StatusUser = last.StatusUser
		}
	}

	query := `
		INSERT INTO mcc_shipments (
			row_key, load_id, load_tracking_number, response_required_by_date,
			total_distance_miles, stops_in_transit, service, trailer_equipment_type,
			total_cost_usd, total_pieces, total_pallets, weight_lb, volume_cuft,
			origin_address, destination_address, start_datetime, end_datetime,
			commodity, tender_request_id,
			rate, rate_interval, comments, user_id, is_hot, order_number, font_size,
			is_bold, status_user, is_lock, is_mcc, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
			$18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, NOW(), NOW()
		)
		RETURNING id, created_at, updated_at
	`

	err := r.db.QueryRow(ctx, query,
		shipment.RowKey, shipment.LoadID, shipment.LoadTrackingNumber,
		shipment.ResponseRequiredByDate, shipment.TotalDistanceMiles, shipment.StopsInTransit,
		shipment.Service, shipment.TrailerEquipmentType, shipment.TotalCostUSD,
		shipment.TotalPieces, shipment.TotalPallets, shipment.WeightLB, shipment.VolumeCuFT,
		shipment.OriginAddress, shipment.DestinationAddress, shipment.StartDatetime,
		shipment.EndDatetime, shipment.Commodity, shipment.TenderRequestID,
		shipment.Rate, shipment.RateInterval, shipment.Comments, shipment.UserID,
		shipment.IsHot, shipment.OrderNumber, shipment.FontSize, shipment.IsBold,
		shipment.StatusUser, shipment.IsLock, shipment.IsMCC,
	).Scan(&shipment.ID, &shipment.CreatedAt, &shipment.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("upsert failed: %w", err)
	}

	return shipment, nil
}

// Helper functions for numeric normalization
func parseFloat(s string) sql.NullFloat64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return sql.NullFloat64{}
	}
	// Remove currency symbols and commas
	s = strings.ReplaceAll(s, "$", "")
	s = strings.ReplaceAll(s, ",", "")
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return sql.NullFloat64{Float64: f, Valid: true}
	}
	return sql.NullFloat64{}
}

func parseInt32(s string) sql.NullInt32 {
	s = strings.TrimSpace(s)
	if s == "" {
		return sql.NullInt32{}
	}
	s = strings.ReplaceAll(s, ",", "")
	if i, err := strconv.ParseInt(s, 10, 32); err == nil {
		return sql.NullInt32{Int32: int32(i), Valid: true}
	}
	return sql.NullInt32{}
}

func extractDate(datetime string) string {
	// Extract just MM/DD/YYYY from "MM/DD/YYYY HH:MM" format
	parts := strings.Split(datetime, " ")
	if len(parts) > 0 {
		return parts[0]
	}
	return datetime
}
