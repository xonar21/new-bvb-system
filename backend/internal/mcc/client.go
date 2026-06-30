package mcc

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// Client handles JDA login and HTML fetching with cookie management
type Client struct {
	baseURL    string
	loginUser  string
	loginToken string
	httpClient *http.Client
	isLoggedIn bool
}

// NewClient creates a new MCC JDA client
func NewClient(baseURL, loginUser, loginToken string) *Client {
	jar, _ := cookiejar.New(&cookiejar.Options{})
	return &Client{
		baseURL:    baseURL,
		loginUser:  loginUser,
		loginToken: loginToken,
		httpClient: &http.Client{
			Jar:     jar,
			Timeout: 30 * time.Second,
		},
		isLoggedIn: false,
	}
}

// Authenticate performs the 3-step login to JDA
func (c *Client) Authenticate() error {
	// Step 1: GET /tm/framework/Frame.jsp - Initialize session
	frameURL := c.baseURL + "/tm/framework/Frame.jsp"
	resp, err := c.httpClient.Get(frameURL)
	if err != nil {
		return fmt.Errorf("frame init request failed: %w", err)
	}
	resp.Body.Close()

	time.Sleep(3 * time.Second)

	// Step 2: POST /tm/admin/LoginViewController.jsp - Login with token
	loginURL := c.baseURL + "/tm/admin/LoginViewController.jsp"
	formData := url.Values{}
	formData.Set("ControllerAction", "Login")
	formData.Set("newPassword", "")
	formData.Set("loginPassword", c.loginToken)
	formData.Set("loginUser", c.loginUser)
	formData.Set("dspLoginPassword", "******************")

	loginReq, err := http.NewRequest("POST", loginURL, strings.NewReader(formData.Encode()))
	if err != nil {
		return fmt.Errorf("create login request failed: %w", err)
	}

	loginReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginReq.Header.Set("Origin", c.baseURL)
	loginReq.Header.Set("Referer", c.baseURL+"/tm/admin/LoginView.jsp")
	loginReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	loginResp, err := c.httpClient.Do(loginReq)
	if err != nil {
		return fmt.Errorf("login request failed: %w", err)
	}
	loginResp.Body.Close()

	// Check for successful login: must be 302 redirect to set cookies properly
	if loginResp.StatusCode != 302 {
		return fmt.Errorf("login failed: expected 302 redirect, got %d", loginResp.StatusCode)
	}

	c.isLoggedIn = true
	return nil
}

// FetchLoadTable retrieves HTML table for load list
func (c *Client) FetchLoadTable(navpadContextID string) (string, error) {
	if !c.isLoggedIn {
		if err := c.Authenticate(); err != nil {
			return "", fmt.Errorf("authentication failed: %w", err)
		}
	}

	time.Sleep(3 * time.Second)

	// Step 3: GET /tm/entry/LTR_LoadListController.gsm
	tableURL := fmt.Sprintf("%s/tm/entry/LTR_LoadListController.gsm?ControllerAction=Display&IsNavPad=true&NavPadContextID=%s",
		c.baseURL, navpadContextID)

	tableReq, err := http.NewRequest("GET", tableURL, nil)
	if err != nil {
		return "", fmt.Errorf("create table request failed: %w", err)
	}

	tableReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	tableReq.Header.Set("Referer", c.baseURL+"/tm/admin/LoginView.jsp")

	tableResp, err := c.httpClient.Do(tableReq)
	if err != nil {
		return "", fmt.Errorf("table request failed: %w", err)
	}
	defer tableResp.Body.Close()

	if tableResp.StatusCode != 200 {
		return "", fmt.Errorf("table fetch failed: status %d", tableResp.StatusCode)
	}

	body, err := io.ReadAll(tableResp.Body)
	if err != nil {
		return "", fmt.Errorf("read response body failed: %w", err)
	}

	return string(body), nil
}
