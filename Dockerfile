# Multi-stage build: `api` runs the Node API, `web` serves the built Angular app via nginx.

# ---- Dependencies (shared) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund

# ---- Angular build ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- API (production deps only) ----
FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
USER node
EXPOSE 3050
CMD ["node", "server/index.mjs"]

# ---- Web (static files + /api reverse proxy) ----
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/kkr-regional/browser /usr/share/nginx/html
EXPOSE 80
