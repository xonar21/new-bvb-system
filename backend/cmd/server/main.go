package main

import (
	"context"
	"log"
	"time"

	"bvb-datatable/internal/allowedips"
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

	var sheetSync *sheets.SheetsSync

	if cfg.GoogleServiceAccount != "" && cfg.GoogleSheetID != "" {
		sheetsClient, err := sheets.NewClient(cfg.GoogleServiceAccount)
		if err != nil {
			log.Printf("Google Sheets client init failed (sync disabled): %v", err)
		} else {
			sheetSync = sheets.NewSync(sheetsClient, pgPool, cfg.GoogleSheetID)

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
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization",
		AllowCredentials: true,
	}))

	authMW := auth.NewMiddleware(cfg.JWTSecret)

	loadsRepo := loads.NewRepository(pgPool)

	go db.ListenLoadsCreated(context.Background(), cfg.PostgresDSN, func(ctx context.Context, id int64) {
		load, err := loadsRepo.Get(ctx, id)
		if err != nil || load == nil {
			log.Printf("DBListener callback: get load %d failed: %v", id, err)
			return
		}
		wsHub.Broadcast(ws.Message{
			Type:    "load.created",
			Payload: load,
		})
	})

	loadsHandler := loads.NewHandler(loadsRepo, wsHub)

	api := app.Group("/api")
	loadsHandler.RegisterRoutes(api, authMW)

	userRepo := users.NewRepository(pgPool)
	authHandler := auth.NewHandler(userRepo, cfg.JWTSecret, cfg.JWTTTL)
	app.Post("/api/auth/login", authHandler.Login)

	usersHandler := users.NewHandler(userRepo)
	usersHandler.RegisterRoutes(api, authMW, auth.RequireRole("root"))

	allowedIPsRepo := allowedips.NewRepository(pgPool)
	allowedIPsHandler := allowedips.NewHandler(allowedIPsRepo)
	allowedIPsHandler.RegisterRoutes(api, authMW, auth.RequireRole("root"))

	if sheetSync != nil {
		syncHandler := sheets.NewHandler(sheetSync)
		api.Post("/sync", authMW, auth.RequireRole("root"), syncHandler.TriggerSync)
	}

	app.Get("/ws", func(c *fiber.Ctx) error {
		token := c.Query("token")
		if token == "" {
			return c.Status(401).JSON(fiber.Map{"error": "missing token"})
		}
		claims, err := auth.ValidateToken(cfg.JWTSecret, token)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "invalid or expired token"})
		}

		handler := websocket.New(func(conn *websocket.Conn) {
			ws.HandleWS(conn, wsHub, claims.UserID, claims.Email)
		})
		return handler(c)
	})

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
