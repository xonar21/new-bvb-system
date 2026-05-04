package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gofiber/contrib/websocket"
)

type BroadcastMsg struct {
	data     []byte
	senderID int64
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	toOthers   chan BroadcastMsg
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		toOthers:   make(chan BroadcastMsg, 256),
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
			count := len(h.clients)
			h.mu.Unlock()
			h.broadcastPresence(client.UserID, true, count)
			log.Printf("WS client connected: user=%d, total=%d", client.UserID, count)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				count := len(h.clients)
				h.mu.Unlock()
				h.broadcastPresence(client.UserID, false, count)
				log.Printf("WS client disconnected: user=%d, total=%d", client.UserID, count)
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

		case bmsg := <-h.toOthers:
			h.mu.RLock()
			for client := range h.clients {
				if client.UserID != bmsg.senderID {
					select {
					case client.send <- bmsg.data:
					default:
						close(client.send)
						delete(h.clients, client)
					}
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

func (h *Hub) BroadcastToOthers(senderID int64, msg Message) {
	data, err := msg.Bytes()
	if err != nil {
		log.Printf("ws broadcastToOthers marshal error: %v", err)
		return
	}
	h.toOthers <- BroadcastMsg{data: data, senderID: senderID}
}

func (h *Hub) broadcastPresence(userID int64, online bool, count int) {
	msg := Message{
		Type: "presence",
		Payload: PresenceUpdate{
			UserID: userID,
			Online: online,
			Count:  count,
		},
	}
	h.Broadcast(msg)
}

func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

type WSHubInterface interface {
	Broadcast(msg Message)
	BroadcastToOthers(senderID int64, msg Message)
}

func HandleWS(conn *websocket.Conn, hub *Hub, userID int64) {
	client := NewClient(hub, conn, userID)
	hub.register <- client

	go client.WritePump()
	go client.ReadPump()
}

func ParseMessage(data []byte) (*Message, error) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}
