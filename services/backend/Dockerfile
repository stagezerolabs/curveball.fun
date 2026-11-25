FROM oven/bun:1.4-alpine AS web-build

WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++

COPY package.json bun.lock ./
COPY contracts/package.json ./contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY services/backend/package.json ./services/backend/package.json
RUN bun install --frozen-lockfile --network-concurrency=8

COPY index.html vite.config.js tsconfig.json ./
COPY api ./api
COPY public ./public
COPY src ./src
COPY deployments ./deployments

ARG VITE_CHAIN_ID
ARG VITE_RPC_URL
ARG VITE_LAUNCHPAD_ADDRESS
ARG VITE_DEPLOYMENT_BLOCK
ARG VITE_ICARUS_SWAP_ADAPTER
ARG VITE_ICARUS_SWAP_ADAPTER_CODE_HASH
ARG VITE_PRIVY_APP_ID
ARG VITE_PRIVY_CLIENT_ID
ARG VITE_SOCIAL_API_URL
ARG VITE_ADMIN_ADDRESS
ARG CURVEBALL_LOCAL_PREVIEW

ENV VITE_CHAIN_ID=$VITE_CHAIN_ID \
    VITE_RPC_URL=$VITE_RPC_URL \
    VITE_LAUNCHPAD_ADDRESS=$VITE_LAUNCHPAD_ADDRESS \
    VITE_DEPLOYMENT_BLOCK=$VITE_DEPLOYMENT_BLOCK \
    VITE_ICARUS_SWAP_ADAPTER=$VITE_ICARUS_SWAP_ADAPTER \
    VITE_ICARUS_SWAP_ADAPTER_CODE_HASH=$VITE_ICARUS_SWAP_ADAPTER_CODE_HASH \
    VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID \
    VITE_PRIVY_CLIENT_ID=$VITE_PRIVY_CLIENT_ID \
    VITE_SOCIAL_API_URL=$VITE_SOCIAL_API_URL \
    VITE_ADMIN_ADDRESS=$VITE_ADMIN_ADDRESS \
    CURVEBALL_LOCAL_PREVIEW=$CURVEBALL_LOCAL_PREVIEW

RUN if [ "$VITE_CHAIN_ID" = "4153" ]; then bun run build; else bun run build:testnet; fi
RUN find dist -type f -name '*.map' -delete

FROM oven/bun:1.4-alpine

WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++

COPY package.json bun.lock ./
COPY contracts/package.json ./contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY services/backend/package.json ./services/backend/package.json
RUN bun install --frozen-lockfile --filter @curveball/db --filter @curveball/backend --network-concurrency=8

COPY packages/db ./packages/db
RUN bun run --cwd packages/db build
COPY services/backend/src ./services/backend/src
COPY services/backend/certs ./services/backend/certs
COPY api ./api
COPY src/lib/artworkRules.js ./src/lib/artworkRules.js
COPY --from=web-build /app/dist ./dist

USER bun
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["bun", "--preload", "./services/backend/src/platform/instrument.mjs", "services/backend/src/entrypoints/main.mjs"]
