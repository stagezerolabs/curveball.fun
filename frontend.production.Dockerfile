FROM oven/bun:1.4-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY contracts/package.json ./contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY services/social/package.json ./services/social/package.json
RUN bun install --frozen-lockfile --network-concurrency=8

COPY index.html vite.config.js tsconfig.json ./
COPY api ./api
COPY src ./src

ARG VITE_CHAIN_ID
ARG VITE_RPC_URL
ARG VITE_LAUNCHPAD_ADDRESS
ARG VITE_DEPLOYMENT_BLOCK
ARG VITE_PRIVY_APP_ID
ARG VITE_PRIVY_CLIENT_ID
ARG VITE_SOCIAL_API_URL
ARG VITE_ADMIN_ADDRESS

ENV VITE_CHAIN_ID=$VITE_CHAIN_ID \
    VITE_RPC_URL=$VITE_RPC_URL \
    VITE_LAUNCHPAD_ADDRESS=$VITE_LAUNCHPAD_ADDRESS \
    VITE_DEPLOYMENT_BLOCK=$VITE_DEPLOYMENT_BLOCK \
    VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID \
    VITE_PRIVY_CLIENT_ID=$VITE_PRIVY_CLIENT_ID \
    VITE_SOCIAL_API_URL=$VITE_SOCIAL_API_URL \
    VITE_ADMIN_ADDRESS=$VITE_ADMIN_ADDRESS

RUN bun run build
RUN find dist -type f -name '*.map' -delete

FROM oven/bun:1.4-alpine

WORKDIR /app
ENV NODE_ENV=production WEB_PORT=8080

COPY --from=build /app/dist ./dist
COPY api ./api
COPY src/lib/artworkRules.js ./src/lib/artworkRules.js
COPY services/web/server.mjs ./services/web/server.mjs

USER bun
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["bun", "services/web/server.mjs"]
