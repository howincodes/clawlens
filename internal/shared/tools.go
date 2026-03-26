// Package shared contains shared utilities and dependency pins.
package shared

import (
	_ "github.com/golang-jwt/jwt/v5"
	_ "github.com/google/uuid"
	_ "golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
	_ "nhooyr.io/websocket"
)
