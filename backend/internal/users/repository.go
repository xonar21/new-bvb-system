package users

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

func (r *Repository) FindByEmail(ctx context.Context, email string) (*User, error) {
	query := `SELECT id, email, password_hash, name, role, is_blocked, last_active_at, created_at, updated_at
		FROM users WHERE email = $1`

	var u User
	err := r.db.QueryRow(ctx, query, email).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name,
		&u.Role, &u.IsBlocked, &u.LastActiveAt,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("find user: %w", err)
	}

	return &u, nil
}

func (r *Repository) FindByID(ctx context.Context, id int64) (*User, error) {
	query := `SELECT id, email, password_hash, name, role, is_blocked, last_active_at, created_at, updated_at
		FROM users WHERE id = $1`

	var u User
	err := r.db.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name,
		&u.Role, &u.IsBlocked, &u.LastActiveAt,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("find user: %w", err)
	}

	return &u, nil
}
