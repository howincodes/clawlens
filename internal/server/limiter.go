package server

import (
	"fmt"
	"strings"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── LimitResult ───────────────────────────────────────────────────────────────

// LimitResult is the outcome of an EvaluateLimits call.
type LimitResult struct {
	Allowed bool    `json:"allowed"`
	Reason  *string `json:"reason,omitempty"`
}

func blocked(reason string) LimitResult {
	return LimitResult{Allowed: false, Reason: &reason}
}

// ── EvaluateLimits ────────────────────────────────────────────────────────────

// EvaluateLimits checks whether the user is allowed to submit a prompt for the
// given model. It evaluates status, credit, per-model, and time-of-day rules.
func EvaluateLimits(store *Store, user *shared.User, model string, weights shared.CreditWeights) LimitResult {
	// 1. Hard status blocks.
	switch user.Status {
	case "killed":
		return blocked("user has been killed")
	case "paused":
		return blocked("user is paused")
	}

	// 2. Fetch per-user limit rules.
	rules, err := store.GetLimitRules(user.ID)
	if err != nil {
		// Fail open — don't block on store error.
		return LimitResult{Allowed: true}
	}

	for _, rule := range rules {
		switch rule.Type {
		case "credits":
			if rule.Value == nil || rule.Window == nil {
				continue
			}
			since := windowStart(*rule.Window, rule.ScheduleTZ)
			used, err := store.GetCreditUsage(user.ID, since)
			if err != nil {
				continue
			}
			if used >= *rule.Value {
				reason := fmt.Sprintf("credit limit of %d reached for %s window", *rule.Value, *rule.Window)
				return blocked(reason)
			}

		case "per_model":
			if rule.Value == nil || rule.Model == nil || rule.Window == nil {
				continue
			}
			if *rule.Model != model {
				continue
			}
			since := windowStart(*rule.Window, rule.ScheduleTZ)
			count, err := store.GetModelUsageCount(user.ID, model, since)
			if err != nil {
				continue
			}
			if count >= *rule.Value {
				reason := fmt.Sprintf("per-model limit of %d reached for %s", *rule.Value, model)
				return blocked(reason)
			}

		case "time_of_day":
			if rule.ScheduleStart == nil || rule.ScheduleEnd == nil {
				continue
			}
			tz := "UTC"
			if rule.ScheduleTZ != nil && *rule.ScheduleTZ != "" {
				tz = *rule.ScheduleTZ
			}
			loc, err := time.LoadLocation(tz)
			if err != nil {
				loc = time.UTC
			}
			now := time.Now().In(loc)
			hhmm := fmt.Sprintf("%02d:%02d", now.Hour(), now.Minute())
			start := *rule.ScheduleStart
			end := *rule.ScheduleEnd

			// Block if current time is within [start, end).
			if start <= end {
				// Normal range e.g. "09:00" to "17:00"
				if hhmm >= start && hhmm < end {
					reason := fmt.Sprintf("usage blocked between %s and %s (%s)", start, end, tz)
					return blocked(reason)
				}
			} else {
				// Overnight range e.g. "22:00" to "06:00"
				if hhmm >= start || hhmm < end {
					reason := fmt.Sprintf("usage blocked between %s and %s (%s)", start, end, tz)
					return blocked(reason)
				}
			}
		}
	}

	return LimitResult{Allowed: true}
}

// ── CreditCost ────────────────────────────────────────────────────────────────

// CreditCost returns the credit cost for the given model using the provided
// weights. It matches "opus", "haiku" case-insensitively; defaults to sonnet.
func CreditCost(model string, weights shared.CreditWeights) int {
	lower := strings.ToLower(model)
	switch {
	case strings.Contains(lower, "opus"):
		return weights.Opus
	case strings.Contains(lower, "haiku"):
		return weights.Haiku
	default:
		return weights.Sonnet
	}
}

// ── windowStart ───────────────────────────────────────────────────────────────

// windowStart returns the beginning of the rate-limit window for the given
// window name. tz may be nil or point to an empty string, in which case UTC is
// used.
func windowStart(window string, tz *string) time.Time {
	loc := time.UTC
	if tz != nil && *tz != "" {
		if l, err := time.LoadLocation(*tz); err == nil {
			loc = l
		}
	}

	now := time.Now().In(loc)

	switch window {
	case "daily":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	case "weekly":
		// Find most recent Monday.
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7 // Sunday → 7 so Monday is 1
		}
		daysBack := weekday - 1 // days since Monday
		monday := now.AddDate(0, 0, -daysBack)
		return time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, loc)
	case "monthly":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	case "sliding_24h":
		return now.Add(-24 * time.Hour)
	default:
		return now.Add(-24 * time.Hour)
	}
}
