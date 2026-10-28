#!/usr/bin/env bash
# STEP 4 (and every later release): create/update everything in AWS.
#   infra/aws/deploy.sh --repos-only   first time only: just the image repositories
#   infra/aws/deploy.sh <tag>          plan, ask "yes", apply
# Terraform shows every change and waits for you to type "yes".
set -euo pipefail
. "$(dirname "$0")/env.sh"
files=(-var-file=prod.tfvars -var-file=prod.secrets.tfvars.json)
for f in prod.tfvars prod.secrets.tfvars.json backend-aws.hcl; do
  [ -f "$tf_dir/$f" ] || { echo "Missing infra/terraform/$f — see infra/README.md." >&2; exit 1; }
done

if [ "${1:-}" = "--repos-only" ]; then
  tf apply "${files[@]}" -var image_tag=none -target=aws_ecr_repository.this
  exit 0
fi
if [ "${1:-}" = "--cert-only" ]; then
  tf apply "${files[@]}" -var image_tag=none -target=aws_acm_certificate.main
  tf output acm_validation_records
  exit 0
fi

tag="${1:?usage: deploy.sh <image tag>   (from 03-build-push.sh)}"
tf apply "${files[@]}" -var "image_tag=$tag"
say "Outputs"
tf output
say "Next: infra/aws/smoke-test.sh"
