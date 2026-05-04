package auth

import (
	"log"
	"time"

	"bvb-datatable/internal/users"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	userRepo  *users.Repository
	jwtSecret string
	jwtTTL    time.Duration
}

func NewHandler(userRepo *users.Repository, jwtSecret string, jwtTTL time.Duration) *Handler {
	return &Handler{
		userRepo:  userRepo,
		jwtSecret: jwtSecret,
		jwtTTL:    jwtTTL,
	}
}

func (h *Handler) Login(c *fiber.Ctx) error {
	var req users.LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "email and password are required"})
	}

	user, err := h.userRepo.FindByEmail(c.Context(), req.Email)
	if err != nil {
		log.Printf("Login error finding user: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	if user == nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid credentials"})
	}

	if user.IsBlocked {
		return c.Status(403).JSON(fiber.Map{"error": "account is blocked"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid credentials"})
	}

	token, err := IssueToken(h.jwtSecret, user.ID, user.Email, user.Role, h.jwtTTL)
	if err != nil {
		log.Printf("Login error issuing token: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	user.PasswordHash = ""

	return c.JSON(users.LoginResponse{
		Token: token,
		User:  *user,
	})
}
