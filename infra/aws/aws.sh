#!/usr/bin/env bash
# Run any AWS CLI command with the qacc profile, e.g.
#   infra/aws/aws.sh logs tail /ecs/qacc-prod-worker --since 30m
# Files you pass must be inside the repo folder (it is mounted at /repo).
set -euo pipefail
. "$(dirname "$0")/env.sh"
aws "$@"
