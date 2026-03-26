package main

import (
	"fmt"
	"os"

	"github.com/howincodes/clawlens/internal/client"
)

var version = "dev"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	cmd := os.Args[1]
	switch cmd {
	case "hook":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Usage: clawlens hook <action>")
			os.Exit(1)
		}
		handleHook(os.Args[2])
	case "setup":
		handleSetup()
	case "uninstall":
		client.Uninstall()
	case "status":
		client.Status()
	case "sync":
		client.SyncNow()
	case "doctor":
		client.Doctor(version)
	case "version", "--version", "-v":
		fmt.Printf("clawlens %s\n", version)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", cmd)
		printUsage()
		os.Exit(1)
	}
}

func handleHook(action string) {
	cfg, err := client.LoadConfig()
	if err != nil {
		// No config = not installed, silently exit (don't block Claude Code)
		return
	}
	queue, err := client.NewQueue(client.QueueDBPath())
	if err != nil {
		return
	}
	defer queue.Close()

	// Start background syncer for batch events
	syncer := client.NewSyncer(queue, cfg)
	syncer.Start()
	defer syncer.Stop()

	switch action {
	case "session-start":
		client.HandleSessionStart(cfg, queue)
	case "prompt":
		client.HandlePrompt(cfg, queue)
	case "pre-tool":
		client.HandlePreToolUse(cfg, queue)
	case "stop":
		client.HandleStop(cfg, queue)
	case "stop-error":
		client.HandleStopFailure(cfg, queue)
	case "session-end":
		client.HandleSessionEnd(cfg, queue)
	default:
		fmt.Fprintf(os.Stderr, "Unknown hook action: %s\n", action)
	}
}

func handleSetup() {
	var code, serverURL string
	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--code":
			if i+1 < len(os.Args) {
				code = os.Args[i+1]
				i++
			}
		case "--server":
			if i+1 < len(os.Args) {
				serverURL = os.Args[i+1]
				i++
			}
		}
	}
	if code == "" || serverURL == "" {
		fmt.Fprintln(os.Stderr, "Usage: clawlens setup --code <CODE> --server <URL>")
		os.Exit(1)
	}
	if err := client.Setup(code, serverURL); err != nil {
		fmt.Fprintf(os.Stderr, "Setup failed: %v\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Printf(`ClawLens v%s — AI usage analytics for Claude Code teams

Usage:
  clawlens setup --code <CODE> --server <URL>   Install and configure
  clawlens status                                Show current status
  clawlens sync                                  Force sync events now
  clawlens doctor                                Run diagnostics
  clawlens uninstall                             Remove ClawLens
  clawlens version                               Show version
  clawlens hook <action>                         (internal) Handle hook event

`, version)
}
