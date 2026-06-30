package mcc

import (
	"log"

	"github.com/gofiber/fiber/v2"
)

// Handler handles MCC sync endpoints
type Handler struct {
	sync *Sync
}

// NewHandler creates a new MCC handler
func NewHandler(sync *Sync) *Handler {
	return &Handler{sync: sync}
}

// TriggerSync handles POST /api/mcc/sync
func (h *Handler) TriggerSync(c *fiber.Ctx) error {
	if h.sync == nil {
		return c.Status(400).JSON(fiber.Map{"error": "mcc sync not configured"})
	}

	// Block on sync completion
	if err := h.sync.Sync(c.Context()); err != nil {
		log.Printf("Manual MCC sync error: %v", err)
		return c.Status(500).JSON(fiber.Map{
			"error":   "mcc sync failed",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{"message": "mcc sync completed successfully"})
}

// RegisterRoutes registers MCC routes
func (h *Handler) RegisterRoutes(api fiber.Router, middlewares ...fiber.Handler) {
	group := api.Group("/mcc")
	for _, mw := range middlewares {
		group.Use(mw)
	}
	group.Post("/sync", h.TriggerSync)
}
