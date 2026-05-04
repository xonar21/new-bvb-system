package auth

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

func NewMiddleware(jwtSecret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(401).JSON(fiber.Map{"error": "missing authorization header"})
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
			return c.Status(401).JSON(fiber.Map{"error": "invalid authorization format"})
		}

		claims, err := ValidateToken(jwtSecret, parts[1])
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "invalid or expired token"})
		}

		c.Locals("user_id", claims.UserID)
		c.Locals("user_email", claims.Email)
		c.Locals("user_role", claims.UserRole)

		return c.Next()
	}
}

func RequireRole(role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userRole, ok := c.Locals("user_role").(string)
		if !ok || userRole != role {
			return c.Status(403).JSON(fiber.Map{"error": "insufficient permissions"})
		}
		return c.Next()
	}
}
