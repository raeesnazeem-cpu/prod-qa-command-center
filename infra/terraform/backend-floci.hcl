# Terraform state for the floci "local" stack, in floci's own S3.
bucket                      = "qacc-tfstate-local"
key                         = "qacc/local.tfstate"
region                      = "us-east-1"
access_key                  = "test"
secret_key                  = "test"
use_path_style              = true
skip_credentials_validation = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
skip_s3_checksum            = true
endpoints = {
  s3 = "http://floci:4566"
}
