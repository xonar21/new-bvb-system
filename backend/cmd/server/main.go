package main

import (
	"context"
	"log"
	"time"

	"bvb-datatable/internal/allowedips"
	"bvb-datatable/internal/auth"
	"bvb-datatable/internal/config"
	"bvb-datatable/internal/db"
	"bvb-datatable/internal/layout"
	"bvb-datatable/internal/loads"
	"bvb-datatable/internal/sheetdoc"
	"bvb-datatable/internal/sheets"
	"bvb-datatable/internal/users"
	"bvb-datatable/internal/ws"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

func main() {
	cfg := config.Load()

	pgPool, err := db.NewPostgres(cfg.PostgresDSN)
	if err != nil {
		log.Fatal("DB connect failed:", err)
	}
	defer pgPool.Close()

	db.Migrate(pgPool)

	// loadsRepo is created before the hub so it can be passed as the CellWriter
	// for WS-driven cell persistence (cell.update / cell.bulk-update messages).
	loadsRepo := loads.NewRepository(pgPool)

	wsHub := ws.NewHub(loadsRepo)
	go wsHub.Run()

	var sheetSync *sheets.SheetsSync

	if cfg.SyncEnabled && cfg.GoogleServiceAccount != "" && cfg.GoogleSheetID != "" {
		sheetsClient, err := sheets.NewClient(cfg.GoogleServiceAccount)
		if err != nil {
			log.Printf("Google Sheets client init failed (sync disabled): %v", err)
		} else {
			sheetSync = sheets.NewSync(sheetsClient, pgPool, cfg.GoogleSheetID)
			sheetSync.SetCallbacks(
				func(inserted, updated int) {
					wsHub.Broadcast(ws.Message{
						Type:    "loads.synced",
						Payload: map[string]interface{}{"inserted": inserted, "updated": updated},
					})
				},
				func(err error) {
					wsHub.Broadcast(ws.Message{
						Type:    "sync.error",
						Payload: map[string]interface{}{"error": err.Error()},
					})
				},
			)

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
		log.Println("Google Sheets sync disabled (SYNC_ENABLED off or no credentials)")
	}

	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	})

	app.Use(logger.New())

	app.Use(cors.New(cors.Config{
		AllowOrigins:     joinStrings(cfg.CORSOrigins...),
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization",
		AllowCredentials: true,
	}))

	authMW := auth.NewMiddleware(cfg.JWTSecret)

	loadsHandler := loads.NewHandler(loadsRepo, wsHub)

	api := app.Group("/api")
	loadsHandler.RegisterRoutes(api, authMW)

	userRepo := users.NewRepository(pgPool)
	authHandler := auth.NewHandler(userRepo, cfg.JWTSecret, cfg.JWTTTL)
	app.Post("/api/auth/login", authHandler.Login)

	usersHandler := users.NewHandler(userRepo)
	usersHandler.RegisterRoutes(api, authMW, auth.RequireRoles("admin", "root"))

	layoutRepo := layout.NewRepository(pgPool)
	layoutHandler := layout.NewHandler(layoutRepo, wsHub)
	layoutHandler.RegisterRoutes(api, authMW, auth.RequireRoles("admin", "root"))
	layout.StartLockCleanup(layoutRepo, wsHub)

	// Full sheet document persistence + history. Any authenticated user can read;
	// admin/editor/root may save; only admin/root may view history & restore.
	sheetDocRepo := sheetdoc.NewRepository(pgPool)
	sheetDocHandler := sheetdoc.NewHandler(sheetDocRepo)
	sheetDocHandler.RegisterRoutes(api, authMW,
		auth.RequireRoles("admin", "editor", "root"),
		auth.RequireRoles("admin", "root"))

	allowedIPsRepo := allowedips.NewRepository(pgPool)
	allowedIPsMiddleware := allowedips.NewIPMiddleware(allowedIPsRepo)
	allowedIPsHandler := allowedips.NewHandler(allowedIPsRepo, wsHub)
	allowedIPsHandler.RegisterRoutes(api, authMW, auth.RequireRoles("admin", "root"))

	api.Use(allowedIPsMiddleware.Handler())

	if sheetSync != nil {
		syncHandler := sheets.NewHandler(sheetSync)
		api.Post("/sync", authMW, auth.RequireRoles("admin", "root"), syncHandler.TriggerSync)
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

		// Lookup user from DB to get color
		user, err := userRepo.FindByID(c.Context(), claims.UserID)
		userColor := "#4a90d9" // default fallback
		if err == nil && user != nil {
			userColor = user.Color
		}

		handler := websocket.New(func(conn *websocket.Conn) {
			ws.HandleWS(conn, wsHub, claims.UserID, claims.Email, userColor)
		})
		return handler(c)
	})

	go db.ListenAllowedIPsChanged(context.Background(), cfg.PostgresDSN, func(ctx context.Context) {
		allowedIPsMiddleware.Refresh()
		wsHub.BroadcastBytes([]byte(`{"type":"ip.restriction-changed","payload":{}}`))
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
