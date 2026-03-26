package shared

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// GenerateID returns a new random UUID string.
func GenerateID() string {
	return uuid.New().String()
}

// GenerateToken returns a cryptographically random 64-character hex string.
func GenerateToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// GenerateInstallCode returns a human-readable install code for the given user slug.
func GenerateInstallCode(slug string) string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return fmt.Sprintf("CLM-%s-%s", slug, hex.EncodeToString(b))
}

// HashPassword returns a bcrypt hash of the provided plaintext password.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword reports whether the plaintext password matches the bcrypt hash.
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
