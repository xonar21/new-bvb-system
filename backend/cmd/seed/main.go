package main

import (
	"context"
	"log"

	"bvb-datatable/internal/config"
	"bvb-datatable/internal/db"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	cfg := config.Load()

	pool, err := db.NewPostgres(cfg.PostgresDSN)
	if err != nil {
		log.Fatal("DB connect failed:", err)
	}
	defer pool.Close()

	db.Migrate(pool)

	seeds := []struct {
		Email    string
		Password string
		Name     string
		Role     string
	}{
		{"user1@bvb.local", "password1", "User One", "user"},
		{"user2@bvb.local", "password2", "User Two", "user"},
		{"admin@bvb.local", "admin123", "Administrator", "admin"},
	}

	ctx := context.Background()
	for _, s := range seeds {
		hash, err := bcrypt.GenerateFromPassword([]byte(s.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("hash password for %s: %v", s.Email, err)
		}

		_, err = pool.Exec(ctx, `
			INSERT INTO users (email, password_hash, name, role)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (email) DO UPDATE SET
				password_hash = EXCLUDED.password_hash,
				name = EXCLUDED.name,
				role = EXCLUDED.role
		`, s.Email, string(hash), s.Name, s.Role)
		if err != nil {
			log.Fatalf("seed user %s: %v", s.Email, err)
		}

		log.Printf("Seeded: %s / %s (%s)", s.Email, s.Password, s.Role)
	}

	log.Println("Seed complete")
}
