#!/usr/bin/env bash
# STEP 3: build the 4 QACC images and push them to ECR (+ copy PostgREST there).
# Run from a clean checkout of the branch you want to deploy.
#   infra/aws/03-build-push.sh            # tag = current git commit
#   infra/aws/03-build-push.sh v1.2.0     # your own tag
# ECR repos must exist first: the first time, run
#   infra/aws/deploy.sh --repos-only
set -euo pipefail
. "$(dirname "$0")/env.sh"
tag="${1:-$(git -C "$repo" rev-parse --short HEAD)}"
[ -n "$(git -C "$repo" status --porcelain)" ] && echo "WARNING: uncommitted changes are included in the images."

arch=$(tfvar cpu_architecture); arch=${arch:-ARM64}
case "$arch" in ARM64) platform=linux/arm64 ;; X86_64) platform=linux/amd64 ;; *) echo "bad cpu_architecture $arch"; exit 1 ;; esac
api_host=$(tfvar api_host); ted=$(tfvar ted_base_url); https=$(tfvar https_enabled)
scheme=https; [ "$https" = false ] && scheme=http
[ -n "$api_host" ] || { echo "Fill infra/terraform/prod.tfvars first (api_host)." >&2; exit 1; }

account=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
registry="$account.dkr.ecr.$AWS_REGION.amazonaws.com"
say "Logging Docker in to $registry"
aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"

build() { # name dockerfile [build args...]
  local name=$1 file=$2; shift 2
  say "Building $name:$tag ($platform)"
  docker build --platform "$platform" -f "$repo/$file" -t "$registry/$name:$tag" "$@" "$repo"
  docker push "$registry/$name:$tag"
}

build qacc-api apps/api/Dockerfile
build qacc-worker apps/worker/Dockerfile
build qacc-dbtools infra/db/Dockerfile
build qacc-web apps/web/Dockerfile \
  --build-arg VITE_API_URL="$scheme://$api_host" \
  --build-arg VITE_TED_BASE_URL="$ted"

pgrst=$(sed -n 's/.*default *= *"\(v12[^"]*\)".*/\1/p' "$tf_dir/variables.tf")
say "Copying postgrest:$pgrst to ECR"
docker pull --platform "$platform" "postgrest/postgrest:$pgrst"
docker tag "postgrest/postgrest:$pgrst" "$registry/postgrest:$pgrst"
docker push "$registry/postgrest:$pgrst" || echo "(already in ECR — tags are immutable, that is fine)"

say "Pushed tag $tag. Next: infra/aws/deploy.sh $tag"
