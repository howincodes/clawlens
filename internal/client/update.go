package client

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// CheckAndUpdate downloads and atomically replaces the running binary if an
// update is available according to info. It is a no-op when info is nil or
// info.Available is false.
func CheckAndUpdate(serverURL string, info *shared.UpdateInfo) error {
	if info == nil || !info.Available {
		return nil
	}

	debugLog("update: new version %s available", info.Version)

	// 2. Download binary to a temp file.
	downloadURL := serverURL + info.URL
	tmpFile, err := downloadToTemp(downloadURL)
	if err != nil {
		return fmt.Errorf("update: download: %w", err)
	}

	// 3. Compute SHA-256 of downloaded file.
	sum, err := sha256File(tmpFile)
	if err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("update: checksum: %w", err)
	}

	// 4. Compare with expected checksum.
	if sum != info.SHA256 {
		os.Remove(tmpFile)
		return fmt.Errorf("update: checksum mismatch (got %s, want %s)", sum, info.SHA256)
	}

	// 5. Get current executable path.
	current, err := selfPath()
	if err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("update: resolve self path: %w", err)
	}

	// Make the downloaded binary executable.
	if err := os.Chmod(tmpFile, 0755); err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("update: chmod: %w", err)
	}

	// 6. Atomic replace.
	if err := os.Rename(tmpFile, current); err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("update: replace binary: %w", err)
	}

	// 7. Log success.
	debugLog("update: successfully updated to %s at %s", info.Version, current)
	fmt.Printf("ClawLens updated to version %s\n", info.Version)
	return nil
}

// selfPath returns the absolute, symlink-resolved path to the running binary.
func selfPath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

// downloadToTemp downloads url into a temporary file and returns its path.
func downloadToTemp(url string) (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "clawlens-update-*")
	if err != nil {
		return "", err
	}
	defer tmp.Close()

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}

	return tmp.Name(), nil
}

// sha256File computes the hex-encoded SHA-256 digest of the file at path.
func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
