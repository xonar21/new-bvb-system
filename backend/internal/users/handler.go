package users

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) RegisterRoutes(api fiber.Router, authMW fiber.Handler, rootMW fiber.Handler) {
	users := api.Group("/users", authMW, rootMW)
	users.Get("/", h.Index)
	users.Get("/:id", h.Show)
	users.Post("/", h.Store)
	users.Put("/:id", h.Update)
	users.Delete("/:id", h.Delete)
}

func (h *Handler) Index(c *fiber.Ctx) error {
	users, err := h.repo.FindAll(c.Context())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	for i := range users {
		users[i].PasswordHash = ""
	}

	return c.JSON(fiber.Map{"users": users})
}

func (h *Handler) Show(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	user, err := h.repo.FindByID(c.Context(), id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if user == nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}

	user.PasswordHash = ""
	return c.JSON(fiber.Map{"user": user})
}

func (h *Handler) Store(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "email, password, and name are required"})
	}
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "user" && req.Role != "root" {
		return c.Status(400).JSON(fiber.Map{"error": "role must be 'user' or 'root'"})
	}

	existing, err := h.repo.FindByEmail(c.Context(), req.Email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if existing != nil {
		return c.Status(409).JSON(fiber.Map{"error": "email already exists"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to hash password"})
	}

	user, err := h.repo.Create(c.Context(), req, string(hash))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	user.PasswordHash = ""
	return c.Status(201).JSON(fiber.Map{"user": user})
}

func (h *Handler) Update(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	var req UpdateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.Role != nil && *req.Role != "user" && *req.Role != "root" {
		return c.Status(400).JSON(fiber.Map{"error": "role must be 'user' or 'root'"})
	}

	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to hash password"})
		}
		if err := h.repo.UpdatePassword(c.Context(), id, string(hash)); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}

	user, err := h.repo.Update(c.Context(), id, req)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if user == nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}

	user.PasswordHash = ""
	return c.JSON(fiber.Map{"user": user})
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
	}

	user, err := h.repo.FindByID(c.Context(), id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if user == nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}

	if err := h.repo.Delete(c.Context(), id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"message": "deleted"})
}
