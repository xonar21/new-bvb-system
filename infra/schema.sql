-- BVB Freight Live Datatable - PostgreSQL Schema

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

-- Seed test users (passwords will be hashed by Go app on first run)
INSERT INTO users (email, password_hash, name, role) VALUES
    ('user1@bvb.local', '', 'User One', 'user'),
    ('user2@bvb.local', '', 'User Two', 'user'),
    ('root@bvb.local', '', 'Root Admin', 'root')
ON CONFLICT (email) DO NOTHING;
