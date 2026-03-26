FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /clawlens-server ./cmd/clawlens-server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /clawlens-server /usr/local/bin/clawlens-server
VOLUME /data
EXPOSE 3000
ENV DB_PATH=/data/clawlens.db
ENTRYPOINT ["clawlens-server"]
