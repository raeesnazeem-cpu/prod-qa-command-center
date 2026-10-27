#!/usr/bin/env bash
# Bring up QACC on floci: start floci, then apply Terraform with the floci profile.
# Later phases add: ECR image push, DB bootstrap (infra/db/*.sql), secrets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/floci.env.sh"

docker compose -f "$here/docker-compose.floci.yml" up -d
echo "Waiting for floci on :4566..."
for _ in $(seq 1 60); do
  curl -sf http://localhost:4566/_floci/health >/dev/null 2>&1 && break
  curl -sf http://localhost:4566/ >/dev/null 2>&1 && break
  sleep 2
done

cd "$here/../terraform"
terraform init -input=false
terraform apply -input=false -auto-approve -var env=local
