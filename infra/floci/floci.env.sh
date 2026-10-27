# Source this to point AWS CLI / SDK / Terraform at floci:  source infra/floci/floci.env.sh
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export TF_VAR_use_floci=true
