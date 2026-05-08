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

	CREATE TABLE IF NOT EXISTS allowed_ips (
		id         BIGSERIAL PRIMARY KEY,
		ip         VARCHAR(255) NOT NULL UNIQUE,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_allowed_ips_ip ON allowed_ips(ip);

	CREATE OR REPLACE FUNCTION allowed_ips_notify()
	RETURNS TRIGGER AS $$
	BEGIN
		PERFORM pg_notify('allowed_ips_changed', '');
		RETURN NULL;
	END;
	$$ LANGUAGE plpgsql;

	DROP TRIGGER IF EXISTS allowed_ips_change_trigger ON allowed_ips;
	CREATE TRIGGER allowed_ips_change_trigger
		AFTER INSERT OR DELETE ON allowed_ips
		FOR EACH STATEMENT EXECUTE FUNCTION allowed_ips_notify();

	CREATE TABLE IF NOT EXISTS table_layouts (
		id SERIAL PRIMARY KEY,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		last_edited_by INT REFERENCES users(id),
		last_edited_at TIMESTAMPTZ DEFAULT NOW(),
		column_widths JSONB DEFAULT '{}',
		row_heights JSONB DEFAULT '{}',
		column_locks JSONB DEFAULT '{}',
		row_locks JSONB DEFAULT '{}'
	);

	CREATE TABLE IF NOT EXISTS layout_edit_sessions (
		id SERIAL PRIMARY KEY,
		user_id INT REFERENCES users(id),
		target_type VARCHAR(20) NOT NULL,
		target_name VARCHAR(100) NOT NULL,
		locked_at TIMESTAMPTZ DEFAULT NOW(),
		expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 seconds')
	);

	CREATE INDEX IF NOT EXISTS idx_layout_edit_sessions_expires ON layout_edit_sessions(expires_at);
	CREATE INDEX IF NOT EXISTS idx_layout_edit_sessions_target ON layout_edit_sessions(target_type, target_name);

	INSERT INTO table_layouts (id, column_widths, row_heights)
	VALUES (1, '{}', '{}')
	ON CONFLICT (id) DO NOTHING;

	CREATE OR REPLACE FUNCTION loads_notify_insert()
	RETURNS TRIGGER AS $$
	BEGIN
		PERFORM pg_notify('loads_created', NEW.id::text);
		RETURN NEW;
	END;
	$$ LANGUAGE plpgsql;

	DROP TRIGGER IF EXISTS loads_insert_trigger ON loads;
	CREATE TRIGGER loads_insert_trigger
		AFTER INSERT ON loads
		FOR EACH ROW EXECUTE FUNCTION loads_notify_insert();
	`

	_, err := pool.Exec(ctx, schema)
	if err != nil {
		log.Fatal("Migration failed:", err)
	}

	// Backfill + harden boolean columns (older data may contain NULLs).
	// This prevents pgx scan errors into non-pointer bool fields.
	_, err = pool.Exec(ctx, `
		UPDATE loads SET
			is_bold = COALESCE(is_bold, false),
			is_mcc  = COALESCE(is_mcc, false),
			is_lock = COALESCE(is_lock, false)
		WHERE is_bold IS NULL OR is_mcc IS NULL OR is_lock IS NULL;

		ALTER TABLE loads
			ALTER COLUMN is_bold SET DEFAULT false,
			ALTER COLUMN is_mcc  SET DEFAULT false,
			ALTER COLUMN is_lock SET DEFAULT false;

		ALTER TABLE loads
			ALTER COLUMN is_bold SET NOT NULL,
			ALTER COLUMN is_mcc  SET NOT NULL,
			ALTER COLUMN is_lock SET NOT NULL;
	`)
	if err != nil {
		log.Fatal("Migration backfill failed:", err)
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
