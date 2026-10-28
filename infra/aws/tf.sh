#!/usr/bin/env bash
# Run any Terraform command in infra/terraform with the qacc profile, e.g.
#   infra/aws/tf.sh output
set -euo pipefail
. "$(dirname "$0")/env.sh"
tf "$@"
