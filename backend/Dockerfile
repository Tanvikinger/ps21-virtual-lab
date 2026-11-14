# Build context is the REPOSITORY ROOT (see docker-compose.yml): stage 1 builds the web UI, stage 2 is the backend that also serves it.
FROM node:22-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tailwind.config.js postcss.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/public
COPY backend/package.json backend/package-lock.json ./
# "npm install" (not "ci") so a fresh checkout works even before package-lock.json has been refreshed after adding @aws-sdk/client-cloudwatch
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend/src ./src
COPY --from=web /web/dist ./public
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
