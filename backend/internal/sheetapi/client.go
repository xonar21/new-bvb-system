package sheetapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type SheetLoad struct {
	GateCode     string    `json:"gateCode"`
	PickupDate   time.Time `json:"pickupDate"`
	PickupTime   string    `json:"pickupTime"`
	OriginCity   string    `json:"originCity"`
	OriginState  string    `json:"originState"`
	DeliveryDate time.Time `json:"deliveryDate"`
	DeliveryTime string    `json:"deliveryTime"`
	DestCity     string    `json:"destCity"`
	DestState    string    `json:"destState"`
	Rate         int       `json:"rate"`
	IsHot        bool      `json:"isHot"`
	IsMCC        bool      `json:"isMCC"`
	MccType      string    `json:"mccType"`
}

type listResponse struct {
	Data  []SheetLoad `json:"data"`
	Total int         `json:"total"`
	Page  int         `json:"page"`
	Limit int         `json:"limit"`
}

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// FetchAll parcurge toate paginile și întoarce toate loadurile.
func (c *Client) FetchAll(ctx context.Context) ([]SheetLoad, error) {
	var all []SheetLoad
	page := 1
	limit := 20

	for {
		url := fmt.Sprintf("%s/api/v1/sheet/loads?page=%d&limit=%d", c.baseURL, page, limit)
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		req.Header.Set("X-Api-Key", c.apiKey)

		resp, err := c.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("fetch page %d: %w", page, err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return nil, fmt.Errorf("api error %d: %s", resp.StatusCode, string(body))
		}

		var lr listResponse
		if err := json.NewDecoder(resp.Body).Decode(&lr); err != nil {
			return nil, fmt.Errorf("decode page %d: %w", page, err)
		}

		all = append(all, lr.Data...)

		if len(all) >= lr.Total || len(lr.Data) == 0 {
			break
		}
		page++
	}

	return all, nil
}
