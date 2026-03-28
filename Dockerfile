FROM node:22-slim AS builder

WORKDIR /app
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/tsconfig.json packages/server/vitest.config.ts packages/server/bundle.mjs packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/server/src packages/server/src
COPY packages/dashboard packages/dashboard

# Build dashboard
RUN pnpm --filter dashboard build

# Bundle server with esbuild (skips tsc strict errors)
RUN pnpm --filter @clawlens/server bundle

# --- Production image ---
FROM node:22-slim

WORKDIR /app

# Copy bundled server + dashboard + native deps from builder
COPY --from=builder /app/release/server.mjs ./server.mjs
COPY --from=builder /app/release/node_modules ./node_modules
COPY --from=builder /app/release/package.json ./package.json
COPY --from=builder /app/packages/dashboard/dist ./dashboard

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/clawlens.db
ENV DASHBOARD_DIR=/app/dashboard

CMD ["node", "server.mjs"]
