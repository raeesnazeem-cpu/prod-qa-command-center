# Use official Playwright image which includes Node 20+ and system libraries
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy monorepo configuration and lockfile from root
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all package.json files to leverage Docker caching
COPY apps/worker/package.json ./apps/worker/
COPY packages/ai/package.json ./packages/ai/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies matching the lockfile
RUN pnpm install --frozen-lockfile

# Copy the actual source code
COPY . .

# Build the worker specifically
RUN pnpm --filter worker build

# Set the execution context
CMD ["pnpm", "--filter", "worker", "start"]