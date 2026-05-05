package layout

import (
	"encoding/json"

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

func (h *Handler) RegisterRoutes(api fiber.Router, authMW fiber.Handler, adminMW fiber.Handler) {
	g := api.Group("/table-layout", authMW)
	g.Get("/", h.GetLayout)
	g.Put("/column/:columnName/width", h.UpdateColumnWidth)
	g.Put("/row/:rowIndex/height", h.UpdateRowHeight)
	g.Post("/lock-acquire", h.LockAcquire)
	g.Post("/lock-release", h.LockRelease)
	g.Post("/reset", adminMW, h.Reset)
}

func (h *Handler) GetLayout(c *fiber.Ctx) error {
	layout, err := h.repo.GetLayout(c.Context())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if layout == nil {
		return c.Status(404).JSON(fiber.Map{"error": "layout not found"})
	}

	var columnWidths map[string]int
	json.Unmarshal(layout.ColumnWidths, &columnWidths)
	if columnWidths == nil {
		columnWidths = make(map[string]int)
	}

	var rowHeights map[string]int
	json.Unmarshal(layout.RowHeights, &rowHeights)
	if rowHeights == nil {
		rowHeights = make(map[string]int)
	}

	locks, err := h.repo.GetActiveLocks(c.Context())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	activeCols := make(map[string]LockInfo)
	activeRows := make(map[string]LockInfo)
	for _, l := range locks {
		info := LockInfo{UserID: l.UserID, UserName: l.UserName, ExpiresAt: l.ExpiresAt}
		if l.TargetType == "column" {
			activeCols[l.TargetName] = info
		} else {
			activeRows[l.TargetName] = info
		}
	}

	return c.JSON(fiber.Map{
		"column_widths": columnWidths,
		"row_heights":   rowHeights,
		"active_locks": fiber.Map{
			"columns": activeCols,
			"rows":    activeRows,
		},
	})
}

func (h *Handler) UpdateColumnWidth(c *fiber.Ctx) error {
	columnName := c.Params("columnName")
	if columnName == "" {
		return c.Status(400).JSON(fiber.Map{"error": "missing column name"})
	}

	var req ColumnWidthRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	userID := c.Locals("user_id").(int64)
	userEmail := c.Locals("user_email").(string)

	conflict, err := h.repo.UpdateColumnWidth(c.Context(), columnName, req.Width, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if conflict != nil {
		return c.Status(409).JSON(fiber.Map{"error": "locked by another user", "locked_by": conflict})
	}

	go h.hub.Broadcast(ws.Message{
		Type: "layout.column-width-changed",
		Payload: fiber.Map{
			"column_name": columnName,
			"width":       req.Width,
			"changed_by":  userID,
			"user_name":   userEmail,
		},
	})

	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) UpdateRowHeight(c *fiber.Ctx) error {
	rowIndex := c.Params("rowIndex")
	if rowIndex == "" {
		return c.Status(400).JSON(fiber.Map{"error": "missing row index"})
	}

	var req RowHeightRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	userID := c.Locals("user_id").(int64)
	userEmail := c.Locals("user_email").(string)

	conflict, err := h.repo.UpdateRowHeight(c.Context(), rowIndex, req.Height, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if conflict != nil {
		return c.Status(409).JSON(fiber.Map{"error": "locked by another user", "locked_by": conflict})
	}

	go h.hub.Broadcast(ws.Message{
		Type: "layout.row-height-changed",
		Payload: fiber.Map{
			"row_index":   rowIndex,
			"height":      req.Height,
			"changed_by":  userID,
			"user_name":   userEmail,
		},
	})

	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) LockAcquire(c *fiber.Ctx) error {
	var req LockAcquireRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	if req.TargetType != "column" && req.TargetType != "row" {
		return c.Status(400).JSON(fiber.Map{"error": "target_type must be 'column' or 'row'"})
	}
	if req.TargetName == "" {
		return c.Status(400).JSON(fiber.Map{"error": "target_name is required"})
	}

	userID := c.Locals("user_id").(int64)
	userEmail := c.Locals("user_email").(string)

	resp, err := h.repo.AcquireLock(c.Context(), req.TargetType, req.TargetName, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if resp.Success {
		go h.hub.Broadcast(ws.Message{
			Type: "layout.lock-acquired",
			Payload: fiber.Map{
				"target_type": req.TargetType,
				"target_name": req.TargetName,
				"user_id":     userID,
				"user_name":   userEmail,
				"expires_at":  nil, // client can compute
			},
		})
		return c.JSON(fiber.Map{"success": true})
	}

	return c.Status(409).JSON(fiber.Map{
		"success":   false,
		"locked_by": resp.LockedBy,
	})
}

func (h *Handler) LockRelease(c *fiber.Ctx) error {
	var req LockReleaseRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	if err := h.repo.ReleaseLock(c.Context(), req.TargetType, req.TargetName); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	go h.hub.Broadcast(ws.Message{
		Type: "layout.lock-released",
		Payload: fiber.Map{
			"target_type": req.TargetType,
			"target_name": req.TargetName,
		},
	})

	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) Reset(c *fiber.Ctx) error {
	if err := h.repo.ResetLayout(c.Context()); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	go h.hub.Broadcast(ws.Message{
		Type:    "layout.reset",
		Payload: fiber.Map{},
	})

	return c.JSON(fiber.Map{"success": true})
}
