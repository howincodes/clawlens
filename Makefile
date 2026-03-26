VERSION ?= dev
LDFLAGS := -ldflags "-X main.version=$(VERSION)"

BIN_DIR := bin

SERVER_CMD := ./cmd/clawlens-server
CLIENT_CMD := ./cmd/clawlens

SERVER_BIN := $(BIN_DIR)/clawlens-server
CLIENT_BIN := $(BIN_DIR)/clawlens

.PHONY: all build server client test clean release

all: build

build: server client

server:
	@mkdir -p $(BIN_DIR)
	go build $(LDFLAGS) -o $(SERVER_BIN) $(SERVER_CMD)

client:
	@mkdir -p $(BIN_DIR)
	go build $(LDFLAGS) -o $(CLIENT_BIN) $(CLIENT_CMD)

test:
	go test ./...

clean:
	rm -rf $(BIN_DIR)

release:
	@mkdir -p $(BIN_DIR)
	GOOS=linux   GOARCH=amd64   go build $(LDFLAGS) -o $(BIN_DIR)/clawlens-linux-amd64    $(CLIENT_CMD)
	GOOS=linux   GOARCH=arm64   go build $(LDFLAGS) -o $(BIN_DIR)/clawlens-linux-arm64    $(CLIENT_CMD)
	GOOS=darwin  GOARCH=amd64   go build $(LDFLAGS) -o $(BIN_DIR)/clawlens-darwin-amd64   $(CLIENT_CMD)
	GOOS=darwin  GOARCH=arm64   go build $(LDFLAGS) -o $(BIN_DIR)/clawlens-darwin-arm64   $(CLIENT_CMD)
	GOOS=windows GOARCH=amd64   go build $(LDFLAGS) -o $(BIN_DIR)/clawlens-windows-amd64.exe $(CLIENT_CMD)
	GOOS=windows GOARCH=arm64   go build $(LDFLAGS) -o $(BIN_DIR)/clawlens-windows-arm64.exe $(CLIENT_CMD)
