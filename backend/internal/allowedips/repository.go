package allowedips

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindAll(ctx context.Context) ([]AllowedIP, error) {
	rows, err := r.db.Query(ctx, `SELECT id, ip, created_at, updated_at FROM allowed_ips ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("query allowed_ips: %w", err)
	}
	defer rows.Close()

	var ips []AllowedIP
	for rows.Next() {
		var a AllowedIP
		if err := rows.Scan(&a.ID, &a.IP, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan allowed_ip: %w", err)
		}
		ips = append(ips, a)
	}

	if ips == nil {
		ips = []AllowedIP{}
	}
	return ips, nil
}

func (r *Repository) FindAllIPStrings(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT ip FROM allowed_ips ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("query allowed_ips: %w", err)
	}
	defer rows.Close()

	var ips []string
	for rows.Next() {
		var ip string
		if err := rows.Scan(&ip); err != nil {
			return nil, fmt.Errorf("scan allowed_ip: %w", err)
		}
		ips = append(ips, ip)
	}

	if ips == nil {
		ips = []string{}
	}
	return ips, nil
}

func (r *Repository) FindByIP(ctx context.Context, ip string) (*AllowedIP, error) {
	var a AllowedIP
	err := r.db.QueryRow(ctx, `SELECT id, ip, created_at, updated_at FROM allowed_ips WHERE ip = $1`, ip).Scan(
		&a.ID, &a.IP, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("find allowed_ip: %w", err)
	}
	return &a, nil
}

func (r *Repository) Create(ctx context.Context, ip string) (*AllowedIP, error) {
	var a AllowedIP
	err := r.db.QueryRow(ctx,
		`INSERT INTO allowed_ips (ip, created_at, updated_at) VALUES ($1, NOW(), NOW())
		 RETURNING id, ip, created_at, updated_at`,
		ip,
	).Scan(&a.ID, &a.IP, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create allowed_ip: %w", err)
	}
	return &a, nil
}

func (r *Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, `DELETE FROM allowed_ips WHERE id = $1`, id)
	return err
}
