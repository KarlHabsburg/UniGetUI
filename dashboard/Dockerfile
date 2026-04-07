FROM node:22-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json drizzle.config.ts ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-slim

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/db/audit-immutability.sql ./db/

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
