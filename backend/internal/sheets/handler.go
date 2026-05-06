package sheets

import (
	"context"
	"log"

	"bvb-datatable/internal/ws"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	sync *SheetsSync
	hub  *ws.Hub
}

func NewHandler(sync *SheetsSync, hub *ws.Hub) *Handler {
	return &Handler{sync: sync, hub: hub}
}

func (h *Handler) TriggerSync(c *fiber.Ctx) error {
	if h.sync == nil {
		return c.Status(400).JSON(fiber.Map{"error": "sync is not configured"})
	}

	if h.hub != nil {
		h.hub.Broadcast(ws.Message{Type: "sync.started", Payload: map[string]interface{}{}})
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Manual sync panic: %v", r)
			}
		}()
		if err := h.sync.Sync(context.Background()); err != nil {
			log.Printf("Manual sync error: %v", err)
		}
	}()

	return c.JSON(fiber.Map{"message": "sync triggered"})
}
