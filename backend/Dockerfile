FROM oven/bun:1.4.0-alpine AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY contracts/package.json contracts/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --filter @curveball/backend

FROM oven/bun:1.4.0-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/backend/node_modules ./backend/node_modules
COPY package.json bun.lock ./
COPY backend ./backend

WORKDIR /app/backend
USER bun
EXPOSE 3001

CMD ["sh", "-c", "bun run db:migrate && bun run start"]
