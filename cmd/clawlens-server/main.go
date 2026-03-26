package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	server "github.com/howincodes/clawlens/internal/server"
)

var version = "dev"

func main() {
	port := flag.String("port", envOr("PORT", "3000"), "Server port")
	dbPath := flag.String("db", envOr("DB_PATH", "./clawlens.db"), "Database path")
	adminPass := flag.String("admin-password", envOr("ADMIN_PASSWORD", ""), "Admin password")
	jwtSecret := flag.String("jwt-secret", envOr("JWT_SECRET", ""), "JWT secret")
	mode := flag.String("mode", envOr("CLAWLENS_MODE", "selfhost"), "Mode: saas or selfhost")
	flag.Parse()

	if *adminPass == "" {
		log.Fatal("ADMIN_PASSWORD is required (env var or --admin-password flag)")
	}

	cfg := server.Config{
		Port:          *port,
		AdminPassword: *adminPass,
		DBPath:        *dbPath,
		JWTSecret:     *jwtSecret,
		Mode:          *mode,
	}

	// Graceful shutdown
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		log.Println("Shutting down...")
		os.Exit(0)
	}()

	log.Printf("ClawLens server v%s (mode=%s)", version, *mode)
	if err := server.Run(cfg); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
