# --- build: full workspace install, bundle with tsup ---------------------------
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/ai/package.json ./packages/ai/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter api...

COPY tsconfig.json ./
COPY apps/api ./apps/api
COPY packages/ai ./packages/ai
COPY packages/shared ./packages/shared
RUN pnpm --filter api build

# Production node_modules only (no tsup/typescript/ts-node-dev). @qacc/* are
# bundled into dist by tsup, but their own deps still resolve from node_modules.
RUN pnpm --filter api deploy --prod --legacy /out

# --- runtime -------------------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
