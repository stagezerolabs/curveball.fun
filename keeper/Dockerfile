FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY graduation-keeper.mjs ./

USER node
CMD ["node", "graduation-keeper.mjs"]
