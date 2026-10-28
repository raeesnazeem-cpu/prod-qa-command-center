#!/usr/bin/env bash
# STEP 1 (once per AWS account): where Terraform keeps its notes ("state").
# Creates a private, versioned S3 bucket + a DynamoDB lock table, then writes
# infra/terraform/backend-aws.hcl and runs `terraform init`.
set -euo pipefail
. "$(dirname "$0")/env.sh"

say "Checking your AWS login (profile $AWS_PROFILE, region $AWS_REGION)"
account=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
echo "AWS account: $account"
bucket="qacc-tfstate-$account"

say "State bucket s3://$bucket"
if aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  echo "already exists"
else
  if [ "$AWS_REGION" = us-east-1 ]; then
    aws s3api create-bucket --bucket "$bucket" >/dev/null
  else
    aws s3api create-bucket --bucket "$bucket" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
  aws s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  echo "created"
fi

say "Lock table qacc-tfstate-lock"
if aws dynamodb describe-table --table-name qacc-tfstate-lock >/dev/null 2>&1; then
  echo "already exists"
else
  aws dynamodb create-table --table-name qacc-tfstate-lock \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  echo "created"
fi

cat > "$tf_dir/backend-aws.hcl" <<HCL
bucket         = "$bucket"
key            = "qacc/prod.tfstate"
region         = "$AWS_REGION"
dynamodb_table = "qacc-tfstate-lock"
encrypt        = true
HCL

say "terraform init"
tf init -input=false -reconfigure -backend-config=backend-aws.hcl
say "Done. Next: infra/aws/02-make-secrets.sh"
