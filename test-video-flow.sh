#!/usr/bin/env bash
# One-click end-to-end test for the video-recording barrier.
# Uses prod.env for DB/Redis creds; applies all test overrides in-process
# (TED_PREVIEW_ONLY, VIDEO_RECORDING_ENABLED, shortened delays) — no env edits.
#
# Forces CommonJS so extensionless dynamic imports resolve (the project tsconfig
# is NodeNext, which would otherwise make ts-node use the ESM loader).
set -euo pipefail
cd "$(dirname "$0")/apps/worker"
export TS_NODE_TRANSPILE_ONLY=1
export TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
exec npx ts-node testVideoRecordingBarrier.ts
