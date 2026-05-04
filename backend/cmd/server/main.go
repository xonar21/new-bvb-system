package main

import (
	"context"
	"log"
	"time"

	"bvb-datatable/internal/auth"
	"bvb-datatable/internal/config"
	"bvb-datatable/internal/db"
	"bvb-datatable/internal/loads"
	"bvb-datatable/internal/sheets"
	"bvb-datatable/internal/users"
	"bvb-datatable/internal/ws"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
)

func main() {
	cfg := config.Load()

	pgPool, err := db.NewPostgres(cfg.PostgresDSN)
	if err != nil {
		log.Fatal("DB connect failed:", err)
	}
	defer pgPool.Close()

	db.Migrate(pgPool)

	if cfg.GoogleServiceAccount != "" && cfg.GoogleSheetID != "" {
		sheetsClient, err := sheets.NewClient(cfg.GoogleServiceAccount)
		if err != nil {
			log.Printf("Google Sheets client init failed (sync disabled): %v", err)
		} else {
			sheetSync := sheets.NewSync(sheetsClient, pgPool, cfg.GoogleSheetID)

			go func() {
				ticker := time.NewTicker(cfg.SyncInterval)
				defer ticker.Stop()

				if err := sheetSync.Sync(context.Background()); err != nil {
					log.Println("Initial sync error:", err)
				}

				for range ticker.C {
					if err := sheetSync.Sync(context.Background()); err != nil {
						log.Println("Sync error:", err)
					}
				}
			}()

			log.Printf("Google Sheets sync enabled, interval: %v", cfg.SyncInterval)
		}
	} else {
		log.Println("Google Sheets sync disabled (no credentials or sheet ID)")
	}

	wsHub := ws.NewHub()
	go wsHub.Run()

	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins:     joinStrings(cfg.CORSOrigins...),
		AllowMethods:     "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization",
		AllowCredentials: true,
	}))

	authMW := auth.NewMiddleware(cfg.JWTSecret)

	loadsRepo := loads.NewRepository(pgPool)
	loadsHandler := loads.NewHandler(loadsRepo, wsHub)

	api := app.Group("/api")
	loadsHandler.RegisterRoutes(api, authMW)

	userRepo := users.NewRepository(pgPool)
	authHandler := auth.NewHandler(userRepo, cfg.JWTSecret, cfg.JWTTTL)
	app.Post("/api/auth/login", authHandler.Login)

	app.Get("/ws", authMW, websocket.New(func(c *websocket.Conn) {
		userID := c.Locals("user_id").(int64)
		ws.HandleWS(c, wsHub, userID)
	}))

	log.Printf("Server starting on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatal("Server failed:", err)
	}
}

func joinStrings(strs ...string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += ", "
		}
		result += s
	}
	return result
}
