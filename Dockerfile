FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js fire.js bridge.html ./

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
