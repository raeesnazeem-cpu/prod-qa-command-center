#!/usr/bin/env bash
# AWS CLI against floci, run in a container on the floci network (no local install).
# Usage: infra/floci/aws.sh s3 ls
exec docker run --rm -i --network qacc-floci \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  -v "$PWD":/aws amazon/aws-cli:2.22.0 --endpoint-url http://floci:4566 "$@"
