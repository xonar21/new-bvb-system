package ws

import "encoding/json"

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func (m Message) Bytes() ([]byte, error) {
	return json.Marshal(m)
}

type PresenceUser struct {
	UserID   int64  `json:"user_id"`
	UserName string `json:"user_name"`
}

type PresenceList struct {
	Users []PresenceUser `json:"users"`
	Count int            `json:"count"`
}
