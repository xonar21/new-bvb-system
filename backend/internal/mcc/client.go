package mcc

import (
	"fmt"
	"io"
	"log"
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
	log.Printf("Frame.jsp response: status=%d, cookies=%d", resp.StatusCode, len(c.httpClient.Jar.Cookies(resp.Request.URL)))
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

	log.Printf("Sending login request to %s with user=%s", loginURL, c.loginUser)
	loginResp, err := c.httpClient.Do(loginReq)
	if err != nil {
		return fmt.Errorf("login request failed: %w", err)
	}
	defer loginResp.Body.Close()

	loginBody, _ := io.ReadAll(loginResp.Body)
	snippet := string(loginBody)
	if len(snippet) > 1000 {
		snippet = snippet[:1000]
	}
	log.Printf("Login response: status=%d, body_len=%d, contains_error=%v, contains_login=%v, contains_credentials=%v",
		loginResp.StatusCode, len(loginBody),
		strings.Contains(string(loginBody), "error") || strings.Contains(string(loginBody), "Error"),
		strings.Contains(string(loginBody), "login") || strings.Contains(string(loginBody), "Login"),
		strings.Contains(string(loginBody), "Invalid") || strings.Contains(string(loginBody), "incorrect"))
	log.Printf("Login HTML snippet (first 1000 chars):\n%s\n", snippet)
	log.Printf("Cookies after login: %d", len(c.httpClient.Jar.Cookies(loginResp.Request.URL)))

	// Accept both 302 (redirect) and 200 (HTML page) as successful if cookies are set
	// JDA may return 200 HTML with login page even on successful auth if cookies are properly set
	if loginResp.StatusCode == 200 || loginResp.StatusCode == 302 {
		// Verify cookies were set; if 4+ cookies, login was successful
		cookies := c.httpClient.Jar.Cookies(loginResp.Request.URL)
		if len(cookies) < 3 {
			// Check for explicit error messages in response body
			bodyStr := string(loginBody)
			if strings.Contains(bodyStr, "Invalid") || strings.Contains(bodyStr, "incorrect") || strings.Contains(bodyStr, "failed") {
				return fmt.Errorf("login failed: credentials rejected (status=%d, body contains error)", loginResp.StatusCode)
			}
		}
		c.isLoggedIn = true
		return nil
	}

	return fmt.Errorf("login failed: unexpected status %d (expected 200 or 302)", loginResp.StatusCode)
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

	// Match browser headers
	tableReq.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
	// Don't accept compressed responses - Go stdlib auto-decompresses gzip but not br/zstd
	tableReq.Header.Set("Accept-Encoding", "identity")
	tableReq.Header.Set("Accept-Language", "en-US,en;q=0.9")
	tableReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36")
	tableReq.Header.Set("Referer", c.baseURL+"/tm/framework/NavigationController.jsp")
	tableReq.Header.Set("Sec-Fetch-Dest", "frame")
	tableReq.Header.Set("Sec-Fetch-Mode", "navigate")
	tableReq.Header.Set("Sec-Fetch-Site", "same-origin")
	tableReq.Header.Set("Sec-Fetch-User", "?1")
	tableReq.Header.Set("Upgrade-Insecure-Requests", "1")

	tableResp, err := c.httpClient.Do(tableReq)
	if err != nil {
		return "", fmt.Errorf("table request failed: %w", err)
	}
	defer tableResp.Body.Close()

	// Check for session expiration (302 redirect to login)
	if tableResp.StatusCode == 302 {
		log.Printf("Session expired (302 redirect detected), re-authenticating...")
		c.isLoggedIn = false
		if err := c.Authenticate(); err != nil {
			return "", fmt.Errorf("session re-authentication failed: %w", err)
		}
		// Retry the request with fresh session
		tableReq2, _ := http.NewRequest("GET", tableURL, nil)
		tableReq2.Header = tableReq.Header
		tableResp2, err := c.httpClient.Do(tableReq2)
		if err != nil {
			return "", fmt.Errorf("table retry failed: %w", err)
		}
		defer tableResp2.Body.Close()
		tableResp = tableResp2
	}

	if tableResp.StatusCode != 200 {
		return "", fmt.Errorf("table fetch failed: status %d", tableResp.StatusCode)
	}

	body, err := io.ReadAll(tableResp.Body)
	if err != nil {
		return "", fmt.Errorf("read response body failed: %w", err)
	}

	htmlBody := string(body)
	hasExpectedTable := strings.Contains(htmlBody, "LoadTenderListFormSEARCH_RESULTSTableID")
	hasAnyTable := strings.Contains(htmlBody, "<table")
	hasLoadID := strings.Contains(htmlBody, "Load ID") || strings.Contains(htmlBody, "load_id")
	hasDistance := strings.Contains(htmlBody, "Total Distance") || strings.Contains(htmlBody, "distance")
	log.Printf("JDA table response: %d bytes, has_expected_table=%v, has_any_table=%v, has_LoadID=%v, has_Distance=%v",
		len(htmlBody), hasExpectedTable, hasAnyTable, hasLoadID, hasDistance)

	// Log first 2000 chars for debugging
	snippet := htmlBody
	if len(snippet) > 2000 {
		snippet = snippet[:2000]
	}
	log.Printf("HTML first 2000 chars:\n%s\n", snippet)

	// Log table IDs if response has tables but not the expected one
	if hasAnyTable && !hasExpectedTable {
		// Extract table ids - look for id="..." patterns
		parts := strings.Split(htmlBody, "<table")
		for i, part := range parts[1:] {
			if idx := strings.Index(part, "id=\""); idx >= 0 {
				endIdx := strings.Index(part[idx+4:], "\"")
				if endIdx >= 0 {
					tableID := part[idx+4 : idx+4+endIdx]
					log.Printf("Found table #%d: id=%q", i+1, tableID)
				}
			}
		}
	}

	return htmlBody, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
