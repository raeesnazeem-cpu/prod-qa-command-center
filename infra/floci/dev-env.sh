# Run api/worker with `pnpm dev` against floci instead of Supabase Cloud:
#   (source infra/floci/dev-env.sh && pnpm dev:api)
# Exported vars win over apps/*/.env (dotenv never overrides), so this also forces the
# local safety switches on whatever is in .env: TED preview, no TED/git tokens, AI fix off.
# Needs: floci up, schema loaded (infra/db/load-schema.sh), and
#   docker compose -f infra/floci/docker-compose.floci.yml --profile dev up -d postgrest
_jwt_secret='local-floci-jwt-secret-at-least-32-chars!!'
_repo="$(git rev-parse --show-toplevel)"

export SUPABASE_URL=http://127.0.0.1:3000
export POSTGREST_URL=http://127.0.0.1:3000
export SUPABASE_SERVICE_ROLE_KEY="$(node "$_repo/infra/db/make-jwt.mjs" "$_jwt_secret" service_role)"
export REALTIME_ENABLED=false

# Storage -> floci S3 (one bucket, old Supabase buckets as prefixes)
export STORAGE_BACKEND=s3
export AWS_S3_BUCKET_NAME=qacc-media-local
export STORAGE_PUBLIC_BASE_URL=http://localhost:4566/qacc-media-local
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export UPSTASH_REDIS_URL=redis://127.0.0.1:6380

export FRONTEND_URL=http://localhost:5173
export SYSTEM_ORG_ID=694e1168-373d-4a82-91e2-a1da99c0d9d5
export SYSTEM_USER_ID=a392f87e-7ac3-42aa-8ef6-3dbbf9b3aa7f

# Local safety (memory: local-test-run-safety, ted-preview-only-switch)
export TED_PREVIEW_ONLY=true
export TED_API_TOKEN=
export AI_FIX_MODULE_ENABLED=false
export GIT_FIX_TOKEN=
export GH_TOKEN_NUVO=
export GIT_TOKEN_MCP_NUVO=
export GIT_FIX_TOKEN_OVERRIDES=
export AUTH_GATE_ENABLED=false
unset _jwt_secret _repo
