package sheetapi

import (
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	sync *Sync
}

func NewHandler(sync *Sync) *Handler {
	return &Handler{sync: sync}
}

// TriggerSync trigger manual sync (POST /api/mcc/sync)
func (h *Handler) TriggerSync(c *fiber.Ctx) error {
	if err := h.sync.Run(c.Context()); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "mcc sync failed",
			"details": err.Error(),
		})
	}
	return c.JSON(fiber.Map{
		"message": "mcc sync completed successfully",
	})
}
