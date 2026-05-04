package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgxpool"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	pgDSN := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		getEnv("PG_USER", "postgres"),
		getEnv("PG_PASSWORD", "secret"),
		getEnv("PG_HOST", "localhost"),
		getEnv("PG_PORT", "5432"),
		getEnv("PG_DB", "bvb_datatable"),
	)

	mysqlDSN := fmt.Sprintf("root:root@tcp(%s:%s)/logistic_dashboard?parseTime=true",
		getEnv("MYSQL_HOST", "localhost"),
		getEnv("MYSQL_PORT", "3306"))

	mysqlDB, err := sql.Open("mysql", mysqlDSN)
	if err != nil {
		log.Fatal("MySQL connect failed:", err)
	}
	defer mysqlDB.Close()
	mysqlDB.SetConnMaxLifetime(30 * time.Second)
	mysqlDB.SetMaxOpenConns(5)

	if err := mysqlDB.Ping(); err != nil {
		log.Fatal("MySQL ping failed:", err)
	}
	log.Println("Connected to MySQL")

	pgPool, err := pgxpool.New(context.Background(), pgDSN)
	if err != nil {
		log.Fatal("PostgreSQL connect failed:", err)
	}
	defer pgPool.Close()
	log.Println("Connected to PostgreSQL")

	rows, err := mysqlDB.Query(`
		SELECT id, order_number, pick_up_date_col1, commodity_col2,
			pickup_date_location_col3, delivery_date_location_col4,
			assigned_user_col5, gate_code_col6, rate_col7,
			rate_min, rate_max, is_bold, is_mcc, font_size,
			status, note_mcc, comments, cell_formats, is_lock,
			created_at, updated_at
		FROM loads ORDER BY id
	`)
	if err != nil {
		log.Fatal("MySQL query failed:", err)
	}
	defer rows.Close()

	total := 0
	inserted := 0
	skipped := 0

	for rows.Next() {
		var id, orderNumber, rateCol7, rateMin, rateMax, fontSize *int64
		var pickUpDate, commodity, pickupLoc, deliveryLoc, assignedUser, gateCode *string
		var status, noteMcc, comments, cellFormats *string
		var isBold, isMcc, isLock bool
		var createdAt, updatedAt time.Time

		err := rows.Scan(
			&id, &orderNumber, &pickUpDate, &commodity,
			&pickupLoc, &deliveryLoc, &assignedUser, &gateCode,
			&rateCol7, &rateMin, &rateMax,
			&isBold, &isMcc, &fontSize,
			&status, &noteMcc, &comments, &cellFormats, &isLock,
			&createdAt, &updatedAt,
		)
		if err != nil {
			log.Fatalf("Scan row %d: %v", total+1, err)
		}

		total++
		if gateCode == nil || *gateCode == "" {
			skipped++
			continue
		}

		_, err = pgPool.Exec(context.Background(), `
			INSERT INTO loads (
				pick_up_date_col1, commodity_col2, pickup_date_location_col3,
				delivery_date_location_col4, assigned_user_col5, gate_code_col6,
				rate_col7, rate_min, rate_max, is_bold, is_mcc,
				font_size, status, note_mcc, comments, cell_formats, is_lock,
				created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
			ON CONFLICT (gate_code_col6) DO UPDATE SET
				pick_up_date_col1 = EXCLUDED.pick_up_date_col1,
				commodity_col2 = EXCLUDED.commodity_col2,
				pickup_date_location_col3 = EXCLUDED.pickup_date_location_col3,
				delivery_date_location_col4 = EXCLUDED.delivery_date_location_col4,
				assigned_user_col5 = EXCLUDED.assigned_user_col5,
				rate_col7 = EXCLUDED.rate_col7,
				rate_min = EXCLUDED.rate_min,
				rate_max = EXCLUDED.rate_max,
				is_bold = EXCLUDED.is_bold,
				is_mcc = EXCLUDED.is_mcc,
				updated_at = NOW()
		`,
			pickUpDate, commodity, pickupLoc,
			deliveryLoc, assignedUser, *gateCode,
			rateCol7, rateMin, rateMax,
			isBold, isMcc,
			fontSize, status, noteMcc, comments, cellFormats, isLock,
			createdAt, updatedAt,
		)
		if err != nil {
			log.Printf("Insert row %d (gate=%s) failed: %v", *id, *gateCode, err)
			skipped++
			continue
		}
		inserted++
	}

	log.Printf("Migration complete: %d total, %d inserted, %d skipped", total, inserted, skipped)
}
