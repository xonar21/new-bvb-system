package sheets

import (
	"context"
	"log"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	sync *SheetsSync
}

func NewHandler(sync *SheetsSync) *Handler {
	return &Handler{sync: sync}
}

func (h *Handler) TriggerSync(c *fiber.Ctx) error {
	if h.sync == nil {
		return c.Status(400).JSON(fiber.Map{"error": "sync is not configured"})
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
