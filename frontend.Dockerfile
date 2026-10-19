# Local dev image: runs the Vite dev server so the /api/artwork upload middleware works.
# VITE_* and PINATA_* values come from the root .env/.env.local via compose env_file, not the image.
FROM oven/bun:1.4-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY contracts/package.json ./contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY services/social/package.json ./services/social/package.json
RUN bun install --frozen-lockfile

COPY index.html vite.config.js tsconfig.json ./
COPY packages/social-contract ./packages/social-contract
COPY api ./api
COPY src ./src

EXPOSE 5173
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
