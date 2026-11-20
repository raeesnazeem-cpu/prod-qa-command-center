# --- build: full workspace install, bundle with tsup ---------------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/ai/package.json ./packages/ai/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter worker...

COPY tsconfig.json ./
COPY apps/worker ./apps/worker
COPY packages/ai ./packages/ai
COPY packages/shared ./packages/shared
RUN pnpm --filter worker build

# Production node_modules only. @qacc/* are bundled into dist by tsup.
RUN pnpm --filter worker deploy --prod --legacy /out

# --- runtime -------------------------------------------------------------------
# Chromium for every check, plus WebKit for the Safari layout-diff and homepage
# gap checks (without it they report "Safari engine not available" on every scan).
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
# Browser + its system libraries, matched to the installed playwright version.
# curl is for the ECS container health check.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && node node_modules/playwright/cli.js install --with-deps chromium webkit \
 && rm -rf /var/lib/apt/lists/* /root/.cache

COPY --from=build /app/apps/worker/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
