package sheets

import (
	"context"
	"fmt"
	"os"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type Client struct {
	service *sheets.Service
}

func NewClient(credentialsFile string) (*Client, error) {
	ctx := context.Background()

	data, err := os.ReadFile(credentialsFile)
	if err != nil {
		return nil, fmt.Errorf("read credentials: %w", err)
	}

	scopes := []string{sheets.SpreadsheetsReadonlyScope}
	config, err := google.JWTConfigFromJSON(data, scopes...)
	if err != nil {
		return nil, fmt.Errorf("jwt config: %w", err)
	}

	client := config.Client(ctx)
	service, err := sheets.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("create sheets service: %w", err)
	}

	return &Client{service: service}, nil
}

func (c *Client) GetSpreadsheet(ctx context.Context, sheetID string) (*sheets.Spreadsheet, error) {
	return c.service.Spreadsheets.Get(sheetID).Do()
}

func (c *Client) GetSheetData(ctx context.Context, sheetID, range_ string, includeGridData bool) (*sheets.Spreadsheet, error) {
	return c.service.Spreadsheets.Get(sheetID).
		Ranges(range_).
		IncludeGridData(includeGridData).
		Do()
}
