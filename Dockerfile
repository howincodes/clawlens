# Stage 1: Build dashboard
FROM node:22-alpine AS dashboard
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# Stage 2: Build Go server
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /clawlens-server ./cmd/clawlens-server

# Stage 3: Production image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /clawlens-server /usr/local/bin/clawlens-server
COPY --from=dashboard /app/dashboard/dist /usr/share/clawlens/dashboard
VOLUME /data
EXPOSE 3000
ENV DB_PATH=/data/clawlens.db
ENV DASHBOARD_DIR=/usr/share/clawlens/dashboard
ENTRYPOINT ["clawlens-server"]
