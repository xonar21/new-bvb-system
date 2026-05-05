package allowedips

import "time"

type AllowedIP struct {
	ID        int64     `json:"id"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AllowedIPsResponse struct {
	AllowedIPs []AllowedIP `json:"allowed_ips"`
}
