FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_SHOW_BRAND_FOOTER=true
ENV VITE_SHOW_BRAND_FOOTER=$VITE_SHOW_BRAND_FOOTER
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run api:build

FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3001
CMD ["node", "dist-server/server/index.js"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
