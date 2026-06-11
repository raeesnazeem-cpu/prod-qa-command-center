# Use a clean, official Node image matching this setup
FROM node:18-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.3.3 --activate

WORKDIR /app

# Copy monorepo configuration and lockfile from root
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all package.json files to leverage Docker caching
COPY apps/worker/package.json ./apps/worker/
# (If worker depends on internal packages or shared folders, copy their package.json files here too)

# Install all dependencies matching the lockfile
RUN pnpm install --frozen-lockfile

# Copy the actual source code
COPY . .

# Build the worker specifically
RUN pnpm --filter worker build

# Set the execution context
CMD ["pnpm", "--filter", "worker", "start"]