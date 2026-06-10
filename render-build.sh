#!/usr/bin/env bash
# Install pnpm
npm install -g pnpm

# Install dependencies and build the monorepo
pnpm install
pnpm build

# Install Playwright browsers and their OS dependencies
npx playwright install --with-deps chromium
