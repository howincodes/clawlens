package shared

import (
	"strings"
	"testing"
)

func TestHashAndVerifyPassword(t *testing.T) {
	password := "super-secret-password"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword returned error: %v", err)
	}
	if hash == "" {
		t.Fatal("HashPassword returned empty string")
	}

	// Correct password must verify successfully.
	if !VerifyPassword(hash, password) {
		t.Error("VerifyPassword returned false for correct password")
	}
}

func TestVerifyPassword_WrongPassword(t *testing.T) {
	password := "correct-horse-battery-staple"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword returned error: %v", err)
	}

	if VerifyPassword(hash, "wrong-password") {
		t.Error("VerifyPassword returned true for wrong password")
	}
}

func TestGenerateID_Uniqueness(t *testing.T) {
	const n = 100
	seen := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		id := GenerateID()
		if _, exists := seen[id]; exists {
			t.Fatalf("GenerateID produced duplicate: %s", id)
		}
		seen[id] = struct{}{}
	}
}

func TestGenerateToken_Length(t *testing.T) {
	token := GenerateToken()
	if len(token) != 64 {
		t.Errorf("GenerateToken length = %d, want 64", len(token))
	}
	// Must be valid hex.
	for _, c := range token {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Errorf("GenerateToken contains non-hex character: %c", c)
		}
	}
}

func TestGenerateInstallCode_Prefix(t *testing.T) {
	code := GenerateInstallCode("alice")
	if !strings.HasPrefix(code, "CLM-") {
		t.Errorf("GenerateInstallCode = %q, want prefix CLM-", code)
	}
	if !strings.Contains(code, "alice") {
		t.Errorf("GenerateInstallCode = %q, want slug alice in code", code)
	}
}
