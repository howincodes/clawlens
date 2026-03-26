package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// WebhookEvent is the payload sent to Slack and Discord webhooks.
type WebhookEvent struct {
	Event        string `json:"event"`
	User         string `json:"user,omitempty"`
	Model        string `json:"model,omitempty"`
	Reason       string `json:"reason,omitempty"`
	Timestamp    string `json:"timestamp"`
	DashboardURL string `json:"dashboard_url,omitempty"`
}

// SendWebhook dispatches the event to any configured Slack / Discord webhooks.
// Each delivery happens in its own goroutine so callers are never blocked.
func SendWebhook(settings *shared.TeamSettings, event WebhookEvent) {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	if settings.SlackWebhook != nil && *settings.SlackWebhook != "" {
		go postSlack(*settings.SlackWebhook, event)
	}
	if settings.DiscordWebhook != nil && *settings.DiscordWebhook != "" {
		go postDiscord(*settings.DiscordWebhook, event)
	}
}

// postSlack POSTs a Block Kit message to the given Slack incoming-webhook URL.
func postSlack(url string, event WebhookEvent) {
	text := fmt.Sprintf("[%s] %s — %s", event.Event, event.User, event.Reason)
	mrkdwn := fmt.Sprintf("*[%s]* %s — %s", event.Event, event.User, event.Reason)

	payload := map[string]any{
		"text": text,
		"blocks": []map[string]any{
			{
				"type": "section",
				"text": map[string]string{
					"type": "mrkdwn",
					"text": mrkdwn,
				},
			},
		},
	}
	postJSON(url, payload)
}

// postDiscord POSTs an embed message to the given Discord webhook URL.
func postDiscord(url string, event WebhookEvent) {
	payload := map[string]any{
		"embeds": []map[string]any{
			{
				"title":       event.Event,
				"description": event.Reason,
				"color":       16733899,
				"timestamp":   event.Timestamp,
				"fields": []map[string]any{
					{
						"name":   "User",
						"value":  event.User,
						"inline": true,
					},
				},
			},
		},
	}
	postJSON(url, payload)
}

// postJSON marshals payload to JSON and POSTs it to url with a 10-second timeout.
func postJSON(url string, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		log.Printf("webhook: marshal error: %v", err)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		log.Printf("webhook: post error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("webhook: unexpected status %d for %s", resp.StatusCode, url)
	}
}
