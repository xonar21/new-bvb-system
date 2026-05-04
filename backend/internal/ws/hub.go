package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
)

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
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
				if !stillOnline {
					h.broadcastFullPresence()
				}
				log.Printf("WS client disconnected: user=%d", client.UserID)
			} else {
				h.mu.Unlock()
			}

		case msg := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- msg:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()

		}
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

func HandleWS(conn *websocket.Conn, hub *Hub, userID int64, userName string) {
	client := NewClient(hub, conn, userID, userName)

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
