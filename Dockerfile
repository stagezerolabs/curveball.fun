FROM oven/bun:1.4.0-alpine AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY contracts/package.json contracts/package.json
RUN bun install --frozen-lockfile --filter curveball
COPY index.html vite.config.js tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1.4.0-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY package.json bun.lock drizzle.config.ts ./
COPY drizzle ./drizzle
USER bun
EXPOSE 3001

CMD ["sh", "-c", "bun run db:migrate && bun run start"]
