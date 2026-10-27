#!/usr/bin/env bash
# Bring up QACC on floci: start floci, then apply Terraform with the floci profile.
# Terraform and the AWS CLI run in containers on the floci network, so nothing
# needs installing locally. Later phases add: ECR image push, DB bootstrap, secrets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tf_dir="$(cd "$here/../terraform" && pwd)"

docker compose -f "$here/docker-compose.floci.yml" up -d
echo "Waiting for floci on :4566..."
until curl -sf http://localhost:4566/_floci/health >/dev/null; do sleep 2; done

tf() {
  docker run --rm --network qacc-floci -v "$tf_dir":/tf -w /tf hashicorp/terraform:1.9.8 "$@"
}
tf init -input=false
tf apply -input=false -auto-approve \
  -var env=local -var use_floci=true -var floci_endpoint=http://floci:4566
