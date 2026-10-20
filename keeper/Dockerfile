FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY graduation-keeper.mjs instrument.mjs ./

USER node
CMD ["node", "--import", "./instrument.mjs", "graduation-keeper.mjs"]
