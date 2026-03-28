FROM node:22-slim AS builder

WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

RUN pnpm install --frozen-lockfile

COPY packages/server/src packages/server/src
COPY packages/dashboard packages/dashboard

RUN pnpm --filter @clawlens/server build
RUN pnpm --filter dashboard build

FROM node:22-slim

WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/dashboard/dist packages/dashboard/dist

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/clawlens.db

CMD ["node", "packages/server/dist/server.js"]
