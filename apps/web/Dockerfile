# QACC web: Vite build -> static files on nginx (SPA fallback to index.html).
# VITE_* values are baked in at build time, so pass them as build args.
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

ARG VITE_API_URL
ARG VITE_TED_BASE_URL
ARG VITE_REALTIME_ENABLED=false
ARG VITE_TASKS_ENABLED=false
# No Supabase in the browser on AWS (plan D8); empty keeps the client inert.
ENV VITE_API_URL=$VITE_API_URL \
    VITE_TED_BASE_URL=$VITE_TED_BASE_URL \
    VITE_REALTIME_ENABLED=$VITE_REALTIME_ENABLED \
    VITE_TASKS_ENABLED=$VITE_TASKS_ENABLED \
    VITE_SUPABASE_URL= \
    VITE_SUPABASE_ANON_KEY=
RUN pnpm --filter web exec vite build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
