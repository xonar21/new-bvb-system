package layout

import (
	"context"
	"log"
	"time"

	"bvb-datatable/internal/ws"

	"github.com/gofiber/fiber/v2"
)

func StartLockCleanup(repo *Repository, hub *ws.Hub) {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			expired, err := repo.CleanupExpiredLocks(context.Background())
			if err != nil {
				log.Printf("Lock cleanup error: %v", err)
				continue
			}

			for _, s := range expired {
				hub.Broadcast(ws.Message{
					Type: "layout.lock-released",
					Payload: fiber.Map{
						"target_type": s.TargetType,
						"target_name": s.TargetName,
						"user_id":     s.UserID,
						"user_name":   s.UserName,
					},
				})
			}
		}
	}()
}
