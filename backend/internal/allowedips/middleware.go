package allowedips

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

type IPMiddleware struct {
	repo      *Repository
	mu        sync.RWMutex
	allowed   []string
	lastFetch time.Time
}

func NewIPMiddleware(repo *Repository) *IPMiddleware {
	m := &IPMiddleware{repo: repo}
	m.refresh()
	return m
}

func (m *IPMiddleware) refresh() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ips, err := m.repo.FindAllIPStrings(ctx)
	if err != nil {
		log.Printf("IPMiddleware refresh error: %v", err)
		return
	}

	m.mu.Lock()
	m.allowed = ips
	m.lastFetch = time.Now()
	m.mu.Unlock()
}

func (m *IPMiddleware) Refresh() {
	m.refresh()
}

func getClientIP(c *fiber.Ctx) string {
	if forwarded := c.Get("X-Forwarded-For"); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	if realIP := c.Get("X-Real-IP"); realIP != "" {
		return realIP
	}
	return c.IP()
}

func (m *IPMiddleware) IsAllowed(c *fiber.Ctx) bool {
	m.mu.RLock()
	allowed := m.allowed
	lastFetch := m.lastFetch
	m.mu.RUnlock()

	if time.Since(lastFetch) > 10*time.Second {
		go m.refresh()
	}

	clientIP := getClientIP(c)

	// Allow all if no IPs are configured
	if len(allowed) == 0 {
		return true
	}

	for _, ip := range allowed {
		if clientIP == ip {
			return true
		}
	}

	return false
}

func (m *IPMiddleware) Handler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := c.Path()

		if strings.HasPrefix(path, "/api/allowed-ips") || path == "/api/auth/login" || path == "/api/sync" || path == "/ws" {
			return c.Next()
		}

		m.mu.RLock()
		allowed := m.allowed
		lastFetch := m.lastFetch
		m.mu.RUnlock()

		if time.Since(lastFetch) > 10*time.Second {
			go m.refresh()
		}

		clientIP := getClientIP(c)

		// Allow all if no IPs are configured
		if len(allowed) == 0 {
			return c.Next()
		}

		for _, ip := range allowed {
			if clientIP == ip {
				return c.Next()
			}
		}

		return c.Status(403).JSON(fiber.Map{"error": "ip_not_allowed"})
	}
}
