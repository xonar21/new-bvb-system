package sheetdoc

import (
	"encoding/json"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// RegisterRoutes wires the sheet document + history endpoints.
//   - read current sheet: any authenticated user
//   - save / delete-event: writers (admin/editor/root) via writeMW
//   - history (versions + audit + restore): admin only via adminMW
func (h *Handler) RegisterRoutes(api fiber.Router, authMW fiber.Handler, writeMW fiber.Handler, adminMW fiber.Handler) {
	g := api.Group("/sheet", authMW)
	g.Get("/", h.Get)
	g.Put("/", writeMW, h.Save)
	g.Post("/delete-event", writeMW, h.DeleteEvent)

	g.Get("/versions", adminMW, h.ListVersions)
	g.Get("/versions/:id", adminMW, h.GetVersion)
	g.Post("/versions/:id/restore", adminMW, h.Restore)
	g.Get("/audit", adminMW, h.ListAudit)
}

func (h *Handler) Get(c *fiber.Ctx) error {
	doc, err := h.repo.Get(c.Context())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if doc == nil {
		return c.JSON(fiber.Map{"name": "Loads", "data": json.RawMessage("{}")})
	}
	return c.JSON(doc)
}

func (h *Handler) Save(c *fiber.Ctx) error {
	var req SaveRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}
	userID, _ := c.Locals("user_id").(int64)
	userEmail, _ := c.Locals("user_email").(string)

	if err := h.repo.Save(c.Context(), req.Name, req.Data, req.Reason, userID, userEmail); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) DeleteEvent(c *fiber.Ctx) error {
	var req DeleteEventRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}
	userID, _ := c.Locals("user_id").(int64)
	userEmail, _ := c.Locals("user_email").(string)

	if err := h.repo.SaveDeleteEvent(c.Context(), req, userID, userEmail); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) ListVersions(c *fiber.Ctx) error {
	limit, _ := strconv.Atoi(c.Query("limit", "200"))
	versions, err := h.repo.ListVersions(c.Context(), limit)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"versions": versions})
}

func (h *Handler) GetVersion(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}
	v, err := h.repo.GetVersion(c.Context(), id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if v == nil {
		return c.Status(404).JSON(fiber.Map{"error": "version not found"})
	}
	return c.JSON(v)
}

func (h *Handler) Restore(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}
	userID, _ := c.Locals("user_id").(int64)
	userEmail, _ := c.Locals("user_email").(string)

	v, err := h.repo.Restore(c.Context(), id, userID, userEmail)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if v == nil {
		return c.Status(404).JSON(fiber.Map{"error": "version not found"})
	}
	return c.JSON(fiber.Map{"success": true, "name": v.Name, "data": v.Data})
}

func (h *Handler) ListAudit(c *fiber.Ctx) error {
	limit, _ := strconv.Atoi(c.Query("limit", "200"))
	entries, err := h.repo.ListAudit(c.Context(), limit)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"audit": entries})
}
