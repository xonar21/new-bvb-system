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
	query := `SELECT id, email, password_hash, name, role, color, is_blocked, last_active_at, created_at, updated_at
		FROM users WHERE email = $1`

	var u User
	err := r.db.QueryRow(ctx, query, email).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name,
		&u.Role, &u.Color, &u.IsBlocked, &u.LastActiveAt,
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
	query := `SELECT id, email, password_hash, name, role, color, is_blocked, last_active_at, created_at, updated_at
		FROM users WHERE id = $1`

	var u User
	err := r.db.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name,
		&u.Role, &u.Color, &u.IsBlocked, &u.LastActiveAt,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("find user by id: %w", err)
	}

	return &u, nil
}

func (r *Repository) FindAll(ctx context.Context) ([]User, error) {
	query := `SELECT id, email, password_hash, name, role, color, is_blocked, last_active_at, created_at, updated_at
		FROM users ORDER BY id`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("find all users: %w", err)
	}
	defer rows.Close()

	var result []User
	for rows.Next() {
		var u User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.PasswordHash, &u.Name,
			&u.Role, &u.Color, &u.IsBlocked, &u.LastActiveAt,
			&u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		result = append(result, u)
	}

	return result, rows.Err()
}

func (r *Repository) Create(ctx context.Context, req CreateUserRequest, passwordHash string) (*User, error) {
	query := `INSERT INTO users (email, password_hash, name, role, color)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, email, password_hash, name, role, color, is_blocked, last_active_at, created_at, updated_at`

	var u User
	err := r.db.QueryRow(ctx, query,
		req.Email, passwordHash, req.Name, req.Role, "#4a90d9",
	).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name,
		&u.Role, &u.Color, &u.IsBlocked, &u.LastActiveAt,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	return &u, nil
}

func (r *Repository) Update(ctx context.Context, id int64, req UpdateUserRequest) (*User, error) {
	existing, err := r.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	query := `UPDATE users SET updated_at = NOW()`
	args := []any{}
	argIdx := 1

	if req.Email != nil {
		query += fmt.Sprintf(", email = $%d", argIdx)
		args = append(args, *req.Email)
		argIdx++
	}
	if req.Name != nil {
		query += fmt.Sprintf(", name = $%d", argIdx)
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Role != nil {
		query += fmt.Sprintf(", role = $%d", argIdx)
		args = append(args, *req.Role)
		argIdx++
	}
	if req.IsBlocked != nil {
		query += fmt.Sprintf(", is_blocked = $%d", argIdx)
		args = append(args, *req.IsBlocked)
		argIdx++
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING id, email, password_hash, name, role, color, is_blocked, last_active_at, created_at, updated_at", argIdx)
	args = append(args, id)

	var u User
	err = r.db.QueryRow(ctx, query, args...).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name,
		&u.Role, &u.Color, &u.IsBlocked, &u.LastActiveAt,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}

	return &u, nil
}

func (r *Repository) UpdatePassword(ctx context.Context, id int64, passwordHash string) error {
	_, err := r.db.Exec(ctx, `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, passwordHash, id)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return nil
}
