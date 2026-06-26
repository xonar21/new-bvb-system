package sheets

import (
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

	// Block on sync completion to properly report errors to client
	if err := h.sync.Sync(c.Context()); err != nil {
		log.Printf("Manual sync error: %v", err)
		return c.Status(500).JSON(fiber.Map{
			"error":   "sync failed",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{"message": "sync completed successfully"})
}
