#!/usr/bin/env bash
# STEP 2: turn infra/aws/secrets.env into infra/terraform/prod.secrets.tfvars.json.
# Both files stay on your machine (gitignored). Terraform puts the values into
# AWS Secrets Manager; containers read them from there.
set -euo pipefail
. "$(dirname "$0")/env.sh"
[ -f "$aws_dir/secrets.env" ] || {
  echo "First: cp infra/aws/secrets.env.example infra/aws/secrets.env and fill it in." >&2
  exit 1
}
docker run --rm -v "$repo:/repo" -w /repo node:20-alpine \
  node infra/aws/make-secrets.mjs infra/aws/secrets.env infra/terraform/prod.secrets.tfvars.json
say "Done. Next: infra/aws/03-build-push.sh"
