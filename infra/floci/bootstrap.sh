#!/usr/bin/env bash
# Bring up QACC on floci (plan §5, Phase 6):
#   1. start floci
#   2. write infra/terraform/local.auto.tfvars (local-only test secrets + floci ids)
#   3. create the ECR repos, tag images with their ECR names, apply everything else
#
# Expects (until Phase 8 puts them in Terraform): floci RDS `qacc-db` with the schema
# loaded (infra/db/load-schema.sh), ElastiCache `qacc-redis`, bucket qacc-media-local.
#
# Usage: infra/floci/bootstrap.sh [image-tag]   (default: git short sha)
# Build images first, e.g.:
#   docker build -f apps/api/Dockerfile -t qacc-api:<tag> .
#   docker build -f apps/worker/Dockerfile -t qacc-worker:<tag> .
#   docker build -f apps/web/Dockerfile -t qacc-web:<tag> \
#     --build-arg VITE_API_URL=http://api.qacc.localhost:8088 \
#     --build-arg VITE_TED_BASE_URL=http://localhost:9999 .
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
tf_dir="$repo/infra/terraform"
tag="${1:-$(git -C "$repo" rev-parse --short HEAD)}"
aws() { "$here/aws.sh" "$@"; }
tf() {
  docker run --rm --network qacc-floci -v "$tf_dir":/tf -w /tf hashicorp/terraform:1.9.8 "$@"
}

docker compose -f "$here/docker-compose.floci.yml" up -d floci
echo "Waiting for floci on :4566..."
until curl -sf http://localhost:4566/_floci/health >/dev/null; do sleep 2; done

# --- tfvars (local test values only; never real secrets) ---------------------
jwt_secret='local-floci-jwt-secret-at-least-32-chars!!'
db_port=$(aws rds describe-db-instances --db-instance-identifier qacc-db \
  --query 'DBInstances[0].Endpoint.Port' --output text)
subnets=$(aws ec2 describe-subnets --query 'Subnets[].SubnetId' --output json | tr -d ' \n')
service_key=$(node "$repo/infra/db/make-jwt.mjs" "$jwt_secret" service_role)

cat > "$tf_dir/local.auto.tfvars" <<EOF
env            = "local"
use_floci      = true
floci_endpoint = "http://floci:4566"
image_tag      = "$tag"

vpc_id             = "vpc-default-us-east-1"
public_subnet_ids  = $subnets
private_subnet_ids = $subnets

redis_url             = "redis://floci:6379"
media_bucket          = "qacc-media-local"
media_public_base_url = "http://localhost:4566/qacc-media-local"

web_host       = "qacc.localhost"
api_host       = "api.qacc.localhost"
public_web_url = "http://qacc.localhost:8088"

system_org_id  = "694e1168-373d-4a82-91e2-a1da99c0d9d5"
system_user_id = "a392f87e-7ac3-42aa-8ef6-3dbbf9b3aa7f"

# Docker Desktop has limited memory; the Fargate size stays 2 vCPU / 4 GB on AWS.
# (floci enforces valid Fargate pairs: 2 vCPU needs >= 4 GB.)
worker_cpu    = 1024
worker_memory = 3072

app_secrets = {
  PGRST_DB_URI              = "postgres://authenticator:authpw123@floci:$db_port/qacc"
  PGRST_JWT_SECRET          = "$jwt_secret"
  SUPABASE_SERVICE_ROLE_KEY = "$service_key"
  TED_SSO_SECRET            = "local-ted-sso-secret-not-for-prod"
  QACC_SESSION_SECRET       = "local-qacc-session-secret-not-for-prod"
  TED_WEBHOOK_SECRET        = "local-ted-webhook-secret"
  X_API_KEY                 = "local-x-api-key"
  TED_API_TOKEN             = ""
}
EOF

tf init -input=false >/dev/null

# --- ECR repos, then images -----------------------------------------------------
# floci runs with FLOCI_SERVICES_ECS_IMAGE_PULL_BEHAVIOR=prefer-cached, so tasks use
# images already on this Docker daemon under their ECR name. Only tag them: pushing
# would store a second copy (the worker alone is ~6.6 GB). Real AWS pushes to ECR.
tf apply -input=false -auto-approve -target=aws_ecr_repository.this
registry="000000000000.dkr.ecr.us-east-1.localhost:4566"
for app in api worker web; do
  docker tag "qacc-$app:$tag" "$registry/qacc-$app:$tag"
done
pgrst=$(sed -n 's/.*default *= *"\(v12[^"]*\)".*/\1/p' "$tf_dir/variables.tf")
docker pull -q "postgrest/postgrest:$pgrst" >/dev/null
docker tag "postgrest/postgrest:$pgrst" "$registry/postgrest:$pgrst"

# --- everything else -----------------------------------------------------------
tf apply -input=false -auto-approve
echo "web: http://qacc.localhost:8088   api: http://api.qacc.localhost:8088/api/health"
