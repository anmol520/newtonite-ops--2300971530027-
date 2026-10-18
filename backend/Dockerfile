# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript, SQL migrations, and package manifests
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Security: Run as non-root node user
USER node

EXPOSE 4000

CMD ["npm", "start"]
