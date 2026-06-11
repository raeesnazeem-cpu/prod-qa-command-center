# Use a clean, official Node image matching this setup
FROM node:18-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy monorepo configuration and lockfile from root
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all package.json files to leverage Docker caching
COPY apps/api/package.json ./apps/api/
COPY packages/ai/package.json ./packages/ai/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies matching the lockfile
RUN pnpm install --frozen-lockfile

# Copy the actual source code
COPY . .

# Build the api specifically
RUN pnpm --filter api build

# Set the execution context
CMD ["pnpm", "--filter", "api", "start"]
