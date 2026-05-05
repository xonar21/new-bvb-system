package allowedips

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type Broadcaster interface {
	BroadcastBytes(data []byte)
}

type Handler struct {
	repo *Repository
	hub  Broadcaster
}

func NewHandler(repo *Repository, hub Broadcaster) *Handler {
	return &Handler{repo: repo, hub: hub}
}

func (h *Handler) RegisterRoutes(api fiber.Router, authMW fiber.Handler, rootMW fiber.Handler) {
	api.Get("/allowed-ips", h.Index)
	authenticated := api.Group("/allowed-ips", authMW, rootMW)
	authenticated.Post("/", h.Store)
	authenticated.Delete("/:id", h.Destroy)
	authenticated.Post("/delete", h.DestroyByBody)
}

func (h *Handler) Index(c *fiber.Ctx) error {
	ips, err := h.repo.FindAll(c.Context())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(AllowedIPsResponse{AllowedIPs: ips})
}

func (h *Handler) Store(c *fiber.Ctx) error {
	var req struct {
		IP string `json:"ip"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	req.IP = strings.TrimSpace(req.IP)
	if req.IP == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ip is required"})
	}

	existing, err := h.repo.FindByIP(c.Context(), req.IP)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if existing != nil {
		return c.Status(409).JSON(fiber.Map{"error": "ip already exists"})
	}

	ip, err := h.repo.Create(c.Context(), req.IP)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if h.hub != nil {
		h.hub.BroadcastBytes([]byte(`{"type":"ip.restriction-changed","payload":{}}`))
	}

	return c.Status(201).JSON(fiber.Map{"allowed_ip": ip})
}

func (h *Handler) Destroy(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	if err := h.repo.Delete(c.Context(), id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if h.hub != nil {
		h.hub.BroadcastBytes([]byte(`{"type":"ip.restriction-changed","payload":{}}`))
	}

	return c.JSON(fiber.Map{"message": "deleted"})
}

func (h *Handler) DestroyByBody(c *fiber.Ctx) error {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.ID <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	if err := h.repo.Delete(c.Context(), req.ID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if h.hub != nil {
		h.hub.BroadcastBytes([]byte(`{"type":"ip.restriction-changed","payload":{}}`))
	}

	return c.JSON(fiber.Map{"message": "deleted"})
}
