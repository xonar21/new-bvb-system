package loads

import (
	"strconv"

	"bvb-datatable/internal/ws"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	repo *Repository
	hub  *ws.Hub
}

func NewHandler(repo *Repository, hub *ws.Hub) *Handler {
	return &Handler{repo: repo, hub: hub}
}

func (h *Handler) RegisterRoutes(api fiber.Router, auth fiber.Handler) {
	loads := api.Group("/loads", auth)
	loads.Get("/", h.Index)
	loads.Get("/:id", h.Show)
	loads.Post("/", h.Store)
	loads.Put("/:id", h.Update)
	loads.Delete("/:id", h.Delete)
	loads.Post("/bulk-order", h.BulkOrder)
}

func (h *Handler) Index(c *fiber.Ctx) error {
	filters := &Filters{
		DateFrom: c.Query("date_from"),
		DateTo:   c.Query("date_to"),
		Status:   c.Query("status"),
		GateCode: c.Query("gate_code"),
		IsMCC:    c.Query("is_mcc"),
		IsBold:   c.Query("is_bold"),
		IsLock:   c.Query("is_lock"),
	}

	loads, err := h.repo.List(c.Context(), filters)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(LoadsResponse{Loads: loads})
}

func (h *Handler) Show(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	load, err := h.repo.Get(c.Context(), id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if load == nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}

	return c.JSON(fiber.Map{"load": load})
}

func (h *Handler) Store(c *fiber.Ctx) error {
	var req UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	if err := ValidateUpdate(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	load, err := h.repo.Create(c.Context(), req)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(201).JSON(fiber.Map{"load": load})
}

func (h *Handler) Update(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	var req UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	if err := ValidateUpdate(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	load, err := h.repo.Update(c.Context(), id, req)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if load == nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}

	go h.hub.Broadcast(ws.Message{
		Type:    "load.updated",
		Payload: load,
	})

	return c.JSON(fiber.Map{"load": load})
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	load, err := h.repo.Get(c.Context(), id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if load == nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}

	if err := h.repo.Delete(c.Context(), id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	go h.hub.Broadcast(ws.Message{
		Type:    "load.deleted",
		Payload: fiber.Map{"id": id},
	})

	return c.JSON(fiber.Map{"message": "deleted"})
}

func (h *Handler) BulkOrder(c *fiber.Ctx) error {
	var req BulkOrderRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	if err := ValidateBulkOrder(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	if err := h.repo.BulkOrder(c.Context(), req.Items); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	go h.hub.Broadcast(ws.Message{
		Type:    "load.order-updated",
		Payload: req.Items,
	})

	return c.JSON(fiber.Map{"message": "order updated"})
}
