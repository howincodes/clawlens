package client

import "regexp"

// secretPatterns is the ordered list of patterns to search for and redact.
var secretPatterns = []struct {
	name    string
	pattern *regexp.Regexp
	replace string
}{
	{
		"api_key",
		regexp.MustCompile(`(sk-|pk-|api[_-]?key|token)[a-zA-Z0-9_-]{20,}`),
		"[REDACTED-API-KEY]",
	},
	{
		"aws_key",
		regexp.MustCompile(`AKIA[0-9A-Z]{16}`),
		"[REDACTED-AWS-KEY]",
	},
	{
		"connection_string",
		regexp.MustCompile(`(postgres|mysql|mongodb|redis)://[^\s]+`),
		"[REDACTED-CONNECTION-STRING]",
	},
	{
		"private_key",
		regexp.MustCompile(`-----BEGIN (RSA |EC |)PRIVATE KEY-----`),
		"[REDACTED-PRIVATE-KEY]",
	},
	{
		"generic_secret",
		regexp.MustCompile(`(password|secret|passwd)[\s]*[=:]\s*['"][^'"]{8,}`),
		"[REDACTED-SECRET]",
	},
}

// ScrubSecrets replaces all recognised secret patterns in text with their
// redaction placeholders. It returns the scrubbed string and a deduplicated
// list of pattern-type labels that were found.
func ScrubSecrets(text string) (string, []string) {
	seen := make(map[string]bool)
	var found []string

	result := text
	for _, sp := range secretPatterns {
		if sp.pattern.MatchString(result) {
			result = sp.pattern.ReplaceAllString(result, sp.replace)
			if !seen[sp.name] {
				seen[sp.name] = true
				found = append(found, sp.name)
			}
		}
	}
	return result, found
}

// DetectSecrets returns only the list of pattern-type labels found in text,
// without performing any replacement.
func DetectSecrets(text string) []string {
	seen := make(map[string]bool)
	var found []string

	for _, sp := range secretPatterns {
		if sp.pattern.MatchString(text) {
			if !seen[sp.name] {
				seen[sp.name] = true
				found = append(found, sp.name)
			}
		}
	}
	return found
}

// HasSecrets returns true if any secret pattern matches in text.
func HasSecrets(text string) bool {
	for _, sp := range secretPatterns {
		if sp.pattern.MatchString(text) {
			return true
		}
	}
	return false
}
