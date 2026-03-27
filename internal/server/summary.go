package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// SummaryEngine generates AI summaries for users.
type SummaryEngine struct {
	store *Store
}

// NewSummaryEngine creates a SummaryEngine backed by the given store.
func NewSummaryEngine(store *Store) *SummaryEngine {
	return &SummaryEngine{store: store}
}

// GenerateForAllUsers generates summaries for every user in the team for the
// last periodHours hours. Errors per-user are logged but do not abort the loop.
func (se *SummaryEngine) GenerateForAllUsers(teamID string, periodHours int) error {
	settings, err := se.store.GetTeamSettings(teamID)
	if err != nil {
		return fmt.Errorf("get team settings: %w", err)
	}

	users, err := se.store.GetUsers(teamID)
	if err != nil {
		return fmt.Errorf("get users: %w", err)
	}

	now := time.Now().UTC()
	since := now.Add(-time.Duration(periodHours) * time.Hour)

	log.Printf("[summary] generating for %d users (last %dh)", len(users), periodHours)
	for _, user := range users {
		prompts, err := se.store.GetPromptsForSummary(user.ID, since, now)
		if err != nil {
			log.Printf("[summary] error fetching prompts for %s: %v", user.Name, err)
			continue
		}
		if len(prompts) == 0 {
			continue
		}
		log.Printf("[summary] generating for %s (%d prompts)", user.Name, len(prompts))

		promptText := buildSummaryPrompt(user.Name, prompts)
		raw, err := se.callAI(promptText, settings)
		if err != nil {
			log.Printf("summary: callAI for %s: %v", user.ID, err)
			continue
		}

		sum, err := parseSummaryResult(raw)
		if err != nil {
			log.Printf("summary: parse result for %s: %v", user.ID, err)
			continue
		}

		userID := user.ID
		teamIDPtr := teamID
		sum.UserID = &userID
		sum.TeamID = &teamIDPtr
		sum.Type = "user"
		sum.PeriodStart = since
		sum.PeriodEnd = now
		sum.GeneratedAt = time.Now().UTC()
		generatedBy := settings.SummaryProvider
		sum.GeneratedBy = &generatedBy

		if err := se.store.RecordSummary(sum); err != nil {
			log.Printf("summary: record for %s: %v", user.ID, err)
		}
	}
	return nil
}

// summaryResult mirrors the JSON structure the AI returns.
type summaryResult struct {
	Summary              string             `json:"summary"`
	Categories           map[string]int     `json:"categories"`
	Topics               []string           `json:"topics"`
	ProductivityScore    float64            `json:"productivity_score"`
	PromptQualityScore   float64            `json:"prompt_quality_score"`
	ModelEfficiencyScore float64            `json:"model_efficiency_score"`
}

// parseSummaryResult extracts the first JSON object from raw AI output.
func parseSummaryResult(raw string) (*shared.AISummary, error) {
	// Find the JSON object in the output (AI may add prose before/after).
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start == -1 || end == -1 || end <= start {
		return nil, fmt.Errorf("no JSON object found in AI response")
	}
	jsonPart := raw[start : end+1]

	var res summaryResult
	if err := json.Unmarshal([]byte(jsonPart), &res); err != nil {
		return nil, fmt.Errorf("unmarshal summary JSON: %w", err)
	}

	sum := &shared.AISummary{
		SummaryText:          res.Summary,
		Categories:           jsonStr(res.Categories),
		Topics:               jsonStr(res.Topics),
	}
	if res.ProductivityScore > 0 {
		v := res.ProductivityScore
		sum.ProductivityScore = &v
	}
	if res.PromptQualityScore > 0 {
		v := res.PromptQualityScore
		sum.PromptQualityScore = &v
	}
	if res.ModelEfficiencyScore > 0 {
		v := res.ModelEfficiencyScore
		sum.ModelEfficiencyScore = &v
	}
	return sum, nil
}

// buildSummaryPrompt constructs the prompt text sent to the AI provider.
func buildSummaryPrompt(userName string, prompts []shared.Prompt) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(
		"Analyze these Claude Code prompts from %s and return JSON:\n", userName,
	))
	sb.WriteString(`{"summary":"...","categories":{"debugging":0,"feature_dev":0},"topics":["..."],"productivity_score":0,"prompt_quality_score":0,"model_efficiency_score":0}`)
	sb.WriteString(fmt.Sprintf("\n\nPrompts (%d total):\n", len(prompts)))

	for _, p := range prompts {
		ts := p.Timestamp.Format("15:04")
		model := ""
		if p.Model != nil {
			model = *p.Model
		}
		project := ""
		if p.ProjectDir != nil {
			project = *p.ProjectDir
		}

		if p.PromptText != nil && *p.PromptText != "" {
			sb.WriteString(fmt.Sprintf("[%s] (%s) [%s] %s\n", ts, model, project, *p.PromptText))
		} else {
			sb.WriteString(fmt.Sprintf("[%s] (%s) [%s] [prompt, %d chars]\n", ts, model, project, p.PromptLength))
		}
	}

	return sb.String()
}

// callAI dispatches the prompt to the configured AI provider and returns the
// raw text response.
func (se *SummaryEngine) callAI(prompt string, settings *shared.TeamSettings) (string, error) {
	switch settings.SummaryProvider {
	case "claude-code":
		out, err := exec.Command("claude", "-p", prompt, "--output-format", "text").Output()
		if err != nil {
			return "", fmt.Errorf("claude-code exec: %w", err)
		}
		return string(out), nil

	case "anthropic-api":
		apiKey := ""
		if settings.SummaryAPIKey != nil {
			apiKey = *settings.SummaryAPIKey
		}
		return callAnthropic(prompt, apiKey)

	case "openai":
		apiKey := ""
		if settings.SummaryAPIKey != nil {
			apiKey = *settings.SummaryAPIKey
		}
		return callOpenAI(prompt, apiKey)

	case "custom":
		apiURL := ""
		if settings.SummaryAPIURL != nil {
			apiURL = *settings.SummaryAPIURL
		}
		apiKey := ""
		if settings.SummaryAPIKey != nil {
			apiKey = *settings.SummaryAPIKey
		}
		return callCustom(apiURL, apiKey, prompt)

	default:
		return "", fmt.Errorf("unknown summary provider: %q", settings.SummaryProvider)
	}
}

// callAnthropic POSTs to the Anthropic messages API.
func callAnthropic(prompt, apiKey string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      "claude-sonnet-4-20250514",
		"max_tokens": 1024,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	})

	req, err := http.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("anthropic status %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("anthropic decode: %w", err)
	}
	if len(result.Content) == 0 {
		return "", fmt.Errorf("anthropic: empty content")
	}
	return result.Content[0].Text, nil
}

// callOpenAI POSTs to the OpenAI chat completions API.
func callOpenAI(prompt, apiKey string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model": "gpt-4o",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	})

	req, err := http.NewRequest(http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("openai request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("openai status %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("openai decode: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("openai: empty choices")
	}
	return result.Choices[0].Message.Content, nil
}

// callCustom POSTs a plain-text prompt to a custom HTTP endpoint.
// The endpoint is expected to return {"text": "..."} or just raw text.
func callCustom(apiURL, apiKey, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"prompt": prompt,
	})

	req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("custom request: %w", err)
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("custom read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("custom status %d: %s", resp.StatusCode, string(b))
	}
	return string(b), nil
}

// jsonStr marshals v to a JSON string and returns a pointer to it.
// Returns nil if marshalling fails.
func jsonStr(v any) *string {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}
