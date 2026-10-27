terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

locals {
  floci_endpoint = "http://localhost:4566"
}

# One provider, two profiles: use_floci=true points every service at floci's single endpoint.
provider "aws" {
  region = var.region

  access_key = var.use_floci ? "test" : null
  secret_key = var.use_floci ? "test" : null

  skip_credentials_validation = var.use_floci
  skip_metadata_api_check     = var.use_floci
  skip_requesting_account_id  = var.use_floci
  s3_use_path_style           = var.use_floci

  dynamic "endpoints" {
    for_each = var.use_floci ? [1] : []
    content {
      ec2            = local.floci_endpoint
      ecs            = local.floci_endpoint
      ecr            = local.floci_endpoint
      elasticache    = local.floci_endpoint
      elbv2          = local.floci_endpoint
      iam            = local.floci_endpoint
      logs           = local.floci_endpoint
      rds            = local.floci_endpoint
      s3             = local.floci_endpoint
      secretsmanager = local.floci_endpoint
      sts            = local.floci_endpoint
    }
  }

  default_tags {
    tags = {
      app = "qacc"
      env = var.env
    }
  }
}
