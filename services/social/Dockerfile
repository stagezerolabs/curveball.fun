FROM oven/bun:1.4-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/package.json
COPY services/social/package.json ./services/social/package.json
RUN bun install --frozen-lockfile --network-concurrency=8

COPY packages/db ./packages/db
RUN bun run --cwd packages/db build
COPY services/social/src ./services/social/src
COPY services/social/certs ./services/social/certs

USER bun
EXPOSE 8787
CMD ["bun", "--preload", "./services/social/src/instrument.mjs", "services/social/src/main.mjs"]
