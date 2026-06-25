package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
)

// CellWriter persists individual cell changes to the database asynchronously.
// Defined here (not in the loads package) to avoid circular imports.
type CellWriter interface {
	// UpdateCellField updates a single named column in the loads table.
	UpdateCellField(ctx context.Context, loadID int64, field string, value any) error
	// UpdateCellStyle merges a style JSON object into cell_formats JSONB for the given field key.
	UpdateCellStyle(ctx context.Context, loadID int64, field string, style any) error
}

// broadcastExceptMsg pairs a raw message with the client that should NOT receive it.
type broadcastExceptMsg struct {
	data   []byte
	except *Client
}

type Hub struct {
	clients         map[*Client]bool
	broadcast       chan []byte
	broadcastExcept chan broadcastExceptMsg
	register        chan *Client
	unregister      chan *Client
	mu              sync.RWMutex

	// focusMap tracks which user is focused on which cell.
	// Key: "loadID:field", Value: CellFocusPayload
	// Protected by focusMu (separate lock to avoid blocking broadcast).
	focusMap map[string]CellFocusPayload
	focusMu  sync.RWMutex

	// cellWriter is used to persist WS-driven cell edits to the DB asynchronously.
	// May be nil if not wired up (falls back to REST-only persistence).
	cellWriter CellWriter
}

func NewHub(cw CellWriter) *Hub {
	return &Hub{
		clients:         make(map[*Client]bool),
		broadcast:       make(chan []byte, 4096),
		broadcastExcept: make(chan broadcastExceptMsg, 4096),
		register:        make(chan *Client, 256),
		unregister:      make(chan *Client, 256),
		focusMap:        make(map[string]CellFocusPayload),
		cellWriter:      cw,
	}
}

// CellWriterFrom returns the hub's CellWriter (used by client ReadPump).
func (h *Hub) CellWriterFrom() CellWriter {
	return h.cellWriter
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

			// Send focus snapshot to the new client so it sees existing focuses.
			h.sendFocusSnapshot(client)
			h.broadcastFullPresence()
			log.Printf("WS client connected: user=%d (%s)", client.UserID, client.UserName)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				stillOnline := false
				for c := range h.clients {
					if c.UserID == client.UserID {
						stillOnline = true
						break
					}
				}
				h.mu.Unlock()

				// Clear all cell focuses belonging to this user if no other
				// tab/connection of theirs remains online.
				if !stillOnline {
					h.clearUserFocuses(client.UserID)
					h.broadcastFullPresence()
				}
				log.Printf("WS client disconnected: user=%d", client.UserID)
			} else {
				h.mu.Unlock()
			}

		case msg := <-h.broadcast:
			h.mu.RLock()
			stale := make([]*Client, 0)
			for client := range h.clients {
				select {
				case client.send <- msg:
				default:
					stale = append(stale, client)
				}
			}
			h.mu.RUnlock()
			h.dropStale(stale)

		case em := <-h.broadcastExcept:
			h.mu.RLock()
			stale := make([]*Client, 0)
			for client := range h.clients {
				if client == em.except {
					continue
				}
				select {
				case client.send <- em.data:
				default:
					stale = append(stale, client)
				}
			}
			h.mu.RUnlock()
			h.dropStale(stale)
		}
	}
}

// dropStale removes clients whose send buffer is full (they can't keep up).
func (h *Hub) dropStale(stale []*Client) {
	if len(stale) == 0 {
		return
	}
	h.mu.Lock()
	for _, client := range stale {
		if _, ok := h.clients[client]; ok {
			delete(h.clients, client)
			close(client.send)
		}
	}
	h.mu.Unlock()
}

// SetFocus records or removes a cell focus and re-broadcasts it to all clients.
func (h *Hub) SetFocus(p CellFocusPayload) {
	// Key by user: each user has at most one focused cell. This makes moving
	// between cells (and highlighting empty cells) work without stale entries.
	key := fmt.Sprintf("user:%d", p.UserID)

	h.focusMu.Lock()
	if p.Action == "blur" {
		delete(h.focusMap, key)
	} else {
		h.focusMap[key] = p
	}
	h.focusMu.Unlock()

	// Re-broadcast the focus event to all clients.
	msg := Message{Type: "cell.focus", Payload: p}
	data, err := msg.Bytes()
	if err != nil {
		log.Printf("ws SetFocus marshal error: %v", err)
		return
	}
	h.broadcast <- data
}

// sendFocusSnapshot sends the current focus state to a single newly-connected client.
func (h *Hub) sendFocusSnapshot(client *Client) {
	h.focusMu.RLock()
	focuses := make([]CellFocusPayload, 0, len(h.focusMap))
	for _, p := range h.focusMap {
		focuses = append(focuses, p)
	}
	h.focusMu.RUnlock()

	if len(focuses) == 0 {
		return
	}

	msg := Message{
		Type:    "focus.snapshot",
		Payload: FocusSnapshot{Focuses: focuses},
	}
	data, err := msg.Bytes()
	if err != nil {
		log.Printf("ws sendFocusSnapshot marshal error: %v", err)
		return
	}
	// Direct send to this client only (non-blocking — buffer is 256).
	select {
	case client.send <- data:
	default:
		log.Printf("ws sendFocusSnapshot: client send buffer full for user=%d", client.UserID)
	}
}

// clearUserFocuses removes all focus entries belonging to the given user
// and broadcasts a blur event for each so other clients clean up their UI.
func (h *Hub) clearUserFocuses(userID int64) {
	h.focusMu.Lock()
	blurPayloads := make([]CellFocusPayload, 0)
	for key, p := range h.focusMap {
		if p.UserID == userID {
			blur := p
			blur.Action = "blur"
			blurPayloads = append(blurPayloads, blur)
			delete(h.focusMap, key)
		}
	}
	h.focusMu.Unlock()

	for _, p := range blurPayloads {
		msg := Message{Type: "cell.focus", Payload: p}
		data, err := msg.Bytes()
		if err != nil {
			continue
		}
		select {
		case h.broadcast <- data:
		default:
		}
	}
}

func (h *Hub) BroadcastBytes(data []byte) {
	h.broadcast <- data
}

// BroadcastExcept sends raw bytes to all connected clients except the one specified.
// Used for sheet.op forwarding so the originating client doesn't re-apply its own ops.
func (h *Hub) BroadcastExcept(data []byte, except *Client) {
	select {
	case h.broadcastExcept <- broadcastExceptMsg{data: data, except: except}:
	default:
		log.Printf("ws BroadcastExcept: channel full, dropping message")
	}
}

func (h *Hub) Broadcast(msg Message) {
	data, err := msg.Bytes()
	if err != nil {
		log.Printf("ws broadcast marshal error: %v", err)
		return
	}
	h.broadcast <- data
}

func (h *Hub) broadcastFullPresence() {
	h.mu.RLock()
	seen := make(map[int64]PresenceUser)
	for client := range h.clients {
		if _, ok := seen[client.UserID]; !ok {
			seen[client.UserID] = PresenceUser{
				UserID:   client.UserID,
				UserName: client.UserName,
			}
		}
	}
	h.mu.RUnlock()

	users := make([]PresenceUser, 0, len(seen))
	for _, u := range seen {
		users = append(users, u)
	}

	msg := Message{
		Type: "presence",
		Payload: PresenceList{
			Users: users,
			Count: len(users),
		},
	}

	data, err := msg.Bytes()
	if err != nil {
		log.Printf("ws broadcastFullPresence marshal error: %v", err)
		return
	}
	h.broadcast <- data
}

func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func HandleWS(conn *websocket.Conn, hub *Hub, userID int64, userName, userColor string) {
	client := NewClient(hub, conn, userID, userName, userColor)

	select {
	case hub.register <- client:
	case <-time.After(5 * time.Second):
		log.Printf("WS register timeout for user %d, hub may be unavailable", userID)
		conn.Close()
		return
	}

	go client.WritePump()
	client.ReadPump()
}

func ParseMessage(data []byte) (*Message, error) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}
