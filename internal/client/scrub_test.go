package client

import (
	"strings"
	"testing"
)

func TestScrubAPIKey(t *testing.T) {
	input := "token: sk-proj-abcdefghijklmnopqrstuvwxyz1234"
	scrubbed, labels := ScrubSecrets(input)

	if strings.Contains(scrubbed, "sk-proj") {
		t.Errorf("API key not scrubbed: %q", scrubbed)
	}
	if !strings.Contains(scrubbed, "[REDACTED-API-KEY]") {
		t.Errorf("expected [REDACTED-API-KEY] in output, got: %q", scrubbed)
	}
	if len(labels) == 0 {
		t.Error("expected label to be returned, got none")
	}
}

func TestScrubAWSKey(t *testing.T) {
	input := "AKIAIOSFODNN7EXAMPLE1"
	scrubbed, labels := ScrubSecrets(input)

	if strings.Contains(scrubbed, "AKIA") {
		t.Errorf("AWS key not scrubbed: %q", scrubbed)
	}
	if !strings.Contains(scrubbed, "[REDACTED-AWS-KEY]") {
		t.Errorf("expected [REDACTED-AWS-KEY] in output, got: %q", scrubbed)
	}
	if len(labels) == 0 {
		t.Error("expected label to be returned, got none")
	}
}

func TestScrubConnectionString(t *testing.T) {
	input := "postgres://user:pass@localhost/db"
	scrubbed, labels := ScrubSecrets(input)

	if strings.Contains(scrubbed, "postgres://") {
		t.Errorf("connection string not scrubbed: %q", scrubbed)
	}
	if !strings.Contains(scrubbed, "[REDACTED-CONNECTION-STRING]") {
		t.Errorf("expected [REDACTED-CONNECTION-STRING] in output, got: %q", scrubbed)
	}
	if len(labels) == 0 {
		t.Error("expected label to be returned, got none")
	}
}

func TestScrubPrivateKey(t *testing.T) {
	input := "-----BEGIN RSA PRIVATE KEY-----"
	scrubbed, labels := ScrubSecrets(input)

	if strings.Contains(scrubbed, "BEGIN RSA PRIVATE KEY") {
		t.Errorf("private key not scrubbed: %q", scrubbed)
	}
	if !strings.Contains(scrubbed, "[REDACTED-PRIVATE-KEY]") {
		t.Errorf("expected [REDACTED-PRIVATE-KEY] in output, got: %q", scrubbed)
	}
	if len(labels) == 0 {
		t.Error("expected label to be returned, got none")
	}
}

func TestScrubGenericSecret(t *testing.T) {
	input := `password = "supersecretpassword"`
	scrubbed, labels := ScrubSecrets(input)

	if strings.Contains(scrubbed, "supersecretpassword") {
		t.Errorf("generic secret not scrubbed: %q", scrubbed)
	}
	if !strings.Contains(scrubbed, "[REDACTED-SECRET]") {
		t.Errorf("expected [REDACTED-SECRET] in output, got: %q", scrubbed)
	}
	if len(labels) == 0 {
		t.Error("expected label to be returned, got none")
	}
}

func TestScrubNormalText(t *testing.T) {
	input := `func main() { fmt.Println("hello") }`
	scrubbed, labels := ScrubSecrets(input)

	if scrubbed != input {
		t.Errorf("normal text was modified: got %q, want %q", scrubbed, input)
	}
	if len(labels) != 0 {
		t.Errorf("expected no labels for normal text, got %v", labels)
	}
}

func TestDetectSecrets(t *testing.T) {
	labels := DetectSecrets("AKIAIOSFODNN7EXAMPLE1")
	if len(labels) == 0 {
		t.Error("DetectSecrets should find AWS key")
	}

	labels = DetectSecrets("nothing secret here")
	if len(labels) != 0 {
		t.Errorf("DetectSecrets should return empty for clean text, got %v", labels)
	}
}

func TestHasSecrets(t *testing.T) {
	if !HasSecrets("postgres://user:pass@localhost/db") {
		t.Error("HasSecrets should return true for connection string")
	}
	if HasSecrets("func main() {}") {
		t.Error("HasSecrets should return false for normal text")
	}
}
