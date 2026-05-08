package ws

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/contrib/websocket"
)

const (
	// writeWait is the time allowed to write a message to the peer.
	writeWait = 5 * time.Second
	// pongWait is the time allowed to read the next pong message from the peer.
	pongWait = 30 * time.Second
	// pingPeriod is how often we ping the client (must be less than pongWait).
	pingPeriod = (pongWait * 8) / 10
	// maxMessageSize is the maximum message size from client (bytes).
	// 64 KB to accommodate bulk Fortune Sheet op payloads.
	maxMessageSize = 65536
)

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	UserID   int64
	UserName string
}

func NewClient(hub *Hub, conn *websocket.Conn, userID int64, userName string) *Client {
	return &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, 512),
		UserID:   userID,
		UserName: userName,
	}
}

// ReadPump reads messages from the WebSocket connection and dispatches them.
// Runs in a dedicated goroutine per client.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("ws read error user=%d: %v", c.UserID, err)
			}
			break
		}

		var raw struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(message, &raw); err != nil {
			continue
		}

		switch raw.Type {
		case "cell.focus":
			var payload CellFocusPayload
			if err := json.Unmarshal(raw.Payload, &payload); err != nil {
				continue
			}
			payload.UserID = c.UserID
			payload.UserName = c.UserName
			c.hub.SetFocus(payload)

		case "sheet.op":
			// Forward Fortune Sheet JSON Patch ops verbatim (legacy path, kept for compat).
			c.hub.BroadcastExcept(message, c)

		case "cell.update":
			// ── Real-time single-cell edit ─────────────────────────────────────
			// 1. Enrich payload with server-authoritative user info.
			// 2. Broadcast enriched message to all OTHER clients instantly.
			// 3. Persist to DB asynchronously in a goroutine (fire-and-forget).
			var payload CellUpdatePayload
			if err := json.Unmarshal(raw.Payload, &payload); err != nil {
				continue
			}
			payload.UserID = c.UserID
			payload.UserName = c.UserName

			enriched, err := json.Marshal(Message{Type: "cell.update", Payload: payload})
			if err != nil {
				continue
			}
			c.hub.BroadcastExcept(enriched, c)

			if cw := c.hub.CellWriterFrom(); cw != nil {
				go func(p CellUpdatePayload) {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					// Persist even when Value is null — clearing a cell must write NULL to DB.
					if err := cw.UpdateCellField(ctx, p.LoadID, p.Field, p.Value); err != nil {
						log.Printf("ws cell.update field write (load=%d field=%s): %v", p.LoadID, p.Field, err)
					}
					if p.Style != nil {
						if err := cw.UpdateCellStyle(ctx, p.LoadID, p.Field, p.Style); err != nil {
							log.Printf("ws cell.update style write (load=%d field=%s): %v", p.LoadID, p.Field, err)
						}
					}
				}(payload)
			}

		case "cell.bulk-update":
			// ── TSV paste: batch of cell changes ──────────────────────────────
			// Same pattern: broadcast first, then async DB writes.
			var payload CellBulkUpdatePayload
			if err := json.Unmarshal(raw.Payload, &payload); err != nil {
				continue
			}
			payload.UserID = c.UserID
			payload.UserName = c.UserName

			enriched, err := json.Marshal(Message{Type: "cell.bulk-update", Payload: payload})
			if err != nil {
				continue
			}
			c.hub.BroadcastExcept(enriched, c)

			if cw := c.hub.CellWriterFrom(); cw != nil {
				go func(p CellBulkUpdatePayload) {
					ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
					defer cancel()
					for _, u := range p.Updates {
						if err := cw.UpdateCellField(ctx, u.LoadID, u.Field, u.Value); err != nil {
							log.Printf("ws cell.bulk-update field write (load=%d field=%s): %v", u.LoadID, u.Field, err)
						}
					}
				}(payload)
			}
		}
		// Other client→server message types can be added here.
	}
}

// WritePump pumps messages from the hub to the WebSocket connection.
// Runs in a dedicated goroutine per client.
// It drains all pending messages in one write deadline window for efficiency.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Write the first message.
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

			// Drain any additional messages that arrived while we were writing.
			// This reduces round-trip latency under burst conditions (e.g. BulkFormat
			// broadcasting 20 load.updated events at once).
			n := len(c.send)
			for i := 0; i < n; i++ {
				msg, ok := <-c.send
				if !ok {
					return
				}
				if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
