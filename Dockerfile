FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build

FROM node:24-bookworm-slim AS api-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @knewstudio/api --include-workspace-root && npm cache clean --force

FROM api-deps AS api-runtime-deps
RUN npm pkg delete devDependencies.prisma devDependencies.typescript --workspace @knewstudio/api \
    && npm prune --omit=dev --omit=peer --workspace @knewstudio/api --include-workspace-root \
    && rm -rf node_modules/prisma node_modules/@prisma/engines node_modules/typescript node_modules/esbuild node_modules/@esbuild \
    && npm cache clean --force \
    && test ! -e node_modules/prisma \
    && test ! -e node_modules/@prisma/engines \
    && test ! -e node_modules/typescript \
    && test ! -e node_modules/esbuild \
    && test ! -e node_modules/@esbuild \
    && node -e "for (const id of ['@prisma/client/package.json', 'sharp', 'argon2', 'bullmq']) require.resolve(id)"

FROM api-runtime-deps AS api
ENV NODE_ENV=production
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN test ! -e node_modules/prisma \
    && test ! -e node_modules/@prisma/engines \
    && test ! -e node_modules/typescript \
    && test ! -e node_modules/esbuild \
    && test ! -e node_modules/@esbuild \
    && node -e "for (const id of ['@prisma/client', 'sharp', 'argon2', 'bullmq']) require(id)" \
    && mkdir -p /data/media \
    && chown -R node:node /app /data/media
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM api-deps AS migrate
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist/load-secret-files.js ./apps/api/dist/load-secret-files.js
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
USER node
CMD ["node", "--require", "./apps/api/dist/load-secret-files.js", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"]

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
