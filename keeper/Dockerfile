FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY main.mjs abi.mjs ./
COPY src/ ./src/

USER node
CMD ["node", "--import", "./src/runtime/instrument.mjs", "main.mjs"]
