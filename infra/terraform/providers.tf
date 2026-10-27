terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
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
      ec2            = var.floci_endpoint
      ecs            = var.floci_endpoint
      ecr            = var.floci_endpoint
      elasticache    = var.floci_endpoint
      elbv2          = var.floci_endpoint
      iam            = var.floci_endpoint
      logs           = var.floci_endpoint
      rds            = var.floci_endpoint
      s3             = var.floci_endpoint
      secretsmanager = var.floci_endpoint
      sts            = var.floci_endpoint
    }
  }

  default_tags {
    tags = {
      app = "qacc"
      env = var.env
    }
  }
}
