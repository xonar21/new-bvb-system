package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Port    string
	Env     string

	PostgresDSN string

	RedisAddr     string
	RedisPassword string
	RedisDB       int

	GoogleSheetID        string
	GoogleServiceAccount string
	SyncInterval         time.Duration

	JWTSecret     string
	JWTTTL        time.Duration
	CORSOrigins   []string
}

func Load() *Config {
	godotenv.Load()

	return &Config{
		Port:    getEnv("PORT", "3001"),
		Env:     getEnv("ENV", "development"),

		PostgresDSN: buildPostgresDSN(),

		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),

		GoogleSheetID:        getEnv("GOOGLE_SHEET_ID", ""),
		GoogleServiceAccount: getEnv("GOOGLE_SERVICE_ACCOUNT", ""),
		SyncInterval:         getEnvDuration("SYNC_INTERVAL_MINUTES", 10),

		JWTSecret:   getEnv("JWT_SECRET", "super_secret_key_change_in_prod"),
		JWTTTL:      getEnvDuration("JWT_TTL_HOURS", 24),
		CORSOrigins: getEnvSlice("CORS_ORIGINS", "http://localhost:5173"),
	}
}

func buildPostgresDSN() string {
	host := getEnv("PG_HOST", "localhost")
	port := getEnv("PG_PORT", "5432")
	db := getEnv("PG_DB", "bvb_datatable")
	user := getEnv("PG_USER", "postgres")
	pass := getEnv("PG_PASSWORD", "secret")
	sslmode := getEnv("PG_SSLMODE", "disable")

	return "postgres://" + user + ":" + pass + "@" + host + ":" + port + "/" + db + "?sslmode=" + sslmode
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvDuration(key string, fallbackMinutes int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return time.Duration(i) * time.Minute
		}
	}
	return time.Duration(fallbackMinutes) * time.Minute
}

func getEnvSlice(key, fallback string) []string {
	if v := os.Getenv(key); v != "" {
		parts := strings.Split(v, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		return parts
	}
	return []string{fallback}
}
