package db

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func Migrate(pool *pgxpool.Pool) {
	ctx := context.Background()

	schema := `
	CREATE TABLE IF NOT EXISTS loads (
		id                          BIGSERIAL PRIMARY KEY,
		pick_up_date_col1           DATE,
		commodity_col2              VARCHAR(255),
		pickup_date_location_col3   VARCHAR(255),
		delivery_date_location_col4 VARCHAR(255),
		assigned_user_col5          VARCHAR(255),
		gate_code_col6              VARCHAR(255) NOT NULL,
		rate_col7                   INTEGER,
		rate_min                    INTEGER,
		rate_max                    INTEGER,
		is_bold                     BOOLEAN DEFAULT FALSE,
		is_mcc                      BOOLEAN DEFAULT FALSE,
		is_lock                     BOOLEAN DEFAULT FALSE,
		font_size                   INTEGER,
		status                      VARCHAR(100),
		note_mcc                    TEXT,
		comments                    TEXT,
		order_number                INTEGER,
		cell_formats                JSONB,
		created_at                  TIMESTAMPTZ DEFAULT NOW(),
		updated_at                  TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_loads_gate_code_unique ON loads(gate_code_col6);
	CREATE INDEX IF NOT EXISTS idx_loads_pick_up_date ON loads(pick_up_date_col1);
	CREATE INDEX IF NOT EXISTS idx_loads_status ON loads(status);
	CREATE INDEX IF NOT EXISTS idx_loads_gate_code ON loads(gate_code_col6);
	CREATE INDEX IF NOT EXISTS idx_loads_is_mcc ON loads(is_mcc);
	CREATE INDEX IF NOT EXISTS idx_loads_is_bold ON loads(is_bold);
	CREATE INDEX IF NOT EXISTS idx_loads_is_lock ON loads(is_lock);

	CREATE TABLE IF NOT EXISTS users (
		id              BIGSERIAL PRIMARY KEY,
		email           VARCHAR(255) NOT NULL UNIQUE,
		password_hash   VARCHAR(255) NOT NULL,
		name            VARCHAR(255) NOT NULL,
		role            VARCHAR(50) DEFAULT 'user',
		is_blocked      BOOLEAN DEFAULT FALSE,
		last_active_at  TIMESTAMPTZ,
		created_at      TIMESTAMPTZ DEFAULT NOW(),
		updated_at      TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
	`

	_, err := pool.Exec(ctx, schema)
	if err != nil {
		log.Fatal("Migration failed:", err)
	}

	log.Println("Database migration completed")
	seedUsers(pool, ctx)
}

func seedUsers(pool *pgxpool.Pool, ctx context.Context) {
	type seedUser struct {
		Email    string
		Password string
		Name     string
		Role     string
	}

	users := []seedUser{
		{"user1@bvb.local", "password1", "User One", "user"},
		{"user2@bvb.local", "password2", "User Two", "user"},
		{"root@bvb.local", "root123", "Root Admin", "root"},
	}

	for _, u := range users {
		var passwordHash string
		err := pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE email = $1`, u.Email).Scan(&passwordHash)
		if err == nil && passwordHash != "" {
			continue
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(u.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("Seed hash failed for %s: %v", u.Email, err)
			continue
		}

		_, err = pool.Exec(ctx,
			`INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
			u.Email, string(hash), u.Name, u.Role)
		if err != nil {
			log.Printf("Seed upsert failed for %s: %v", u.Email, err)
			continue
		}

		log.Printf("Seeded user: %s (%s)", u.Email, u.Role)
	}
}
