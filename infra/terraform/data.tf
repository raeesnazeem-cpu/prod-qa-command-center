# Data services (plan §4): RDS Postgres, ElastiCache Valkey, the media bucket and
# the CloudFront CDN that serves it. Only when create_data_services = true.

data "aws_caller_identity" "current" {}

locals {
  create_data = var.create_data_services ? 1 : 0
}

# --- RDS PostgreSQL 16 (pgvector is built in; infra/db/02_extensions.sql enables it)

resource "aws_db_subnet_group" "main" {
  count      = local.create_data
  name       = "qacc-${var.env}"
  subnet_ids = local.private_subnet_ids
}

resource "aws_security_group" "db" {
  count       = local.create_data
  name        = "qacc-${var.env}-db"
  description = "QACC RDS: only ECS tasks"
  vpc_id      = local.vpc_id

  ingress {
    description     = "Postgres from tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

resource "aws_db_instance" "main" {
  count                 = local.create_data
  identifier            = "qacc-${var.env}"
  engine                = "postgres"
  engine_version        = "16"
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true
  db_name               = "qacc"
  username              = "qaccadmin"
  # AWS creates the master password and keeps it in Secrets Manager
  # (output db_master_secret_arn). Only the one-off db task reads it.
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.main[0].name
  vpc_security_group_ids      = [aws_security_group.db[0].id]
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = var.db_backup_retention_days
  deletion_protection         = !var.use_floci
  skip_final_snapshot         = var.use_floci
  final_snapshot_identifier   = var.use_floci ? null : "qacc-${var.env}-final"
  auto_minor_version_upgrade  = true
  apply_immediately           = false
}

# --- ElastiCache Valkey (BullMQ queue). noeviction is required by BullMQ.

resource "aws_elasticache_subnet_group" "main" {
  count      = local.create_data
  name       = "qacc-${var.env}"
  subnet_ids = local.private_subnet_ids
}

resource "aws_security_group" "redis" {
  count       = local.create_data
  name        = "qacc-${var.env}-redis"
  description = "QACC Redis: only ECS tasks"
  vpc_id      = local.vpc_id

  ingress {
    description     = "Redis from tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

resource "aws_elasticache_parameter_group" "main" {
  count  = local.create_data
  name   = "qacc-${var.env}-valkey8"
  family = "valkey8"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "main" {
  count                      = local.create_data
  replication_group_id       = "qacc-${var.env}"
  description                = "QACC BullMQ queue"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.main[0].name
  subnet_group_name          = aws_elasticache_subnet_group.main[0].name
  security_group_ids         = [aws_security_group.redis[0].id]
  transit_encryption_enabled = true # app connects with rediss://
  at_rest_encryption_enabled = true
  automatic_failover_enabled = false
}

# --- Media bucket: screenshots/, evidence/, public_evidence/, recordings/ -----
# Private bucket. Browsers read through CloudFront (stable URLs; plan §7.4).

resource "aws_s3_bucket" "media" {
  count         = local.create_data
  bucket        = coalesce(var.media_bucket, "qacc-media-${var.env}-${data.aws_caller_identity.current.account_id}")
  force_destroy = var.use_floci
}

resource "aws_s3_bucket_public_access_block" "media" {
  count                   = local.create_data
  bucket                  = aws_s3_bucket.media[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  count  = local.create_data
  bucket = aws_s3_bucket.media[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  count  = local.create_data
  bucket = aws_s3_bucket.media[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "media" {
  count                             = local.create_data
  name                              = "qacc-${var.env}-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  count           = local.create_data
  enabled         = true
  comment         = "QACC ${var.env} media"
  price_class     = "PriceClass_100" # North America + Europe edges: cheapest
  is_ipv6_enabled = true

  origin {
    origin_id                = "media"
    domain_name              = aws_s3_bucket.media[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS managed "CachingOptimized" policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "media" {
  count  = local.create_data
  bucket = aws_s3_bucket.media[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.media[0].arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media[0].arn }
      }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.media]
}

locals {
  media_bucket          = var.create_data_services ? aws_s3_bucket.media[0].bucket : var.media_bucket
  media_public_base_url = var.create_data_services ? "https://${aws_cloudfront_distribution.media[0].domain_name}" : var.media_public_base_url
  redis_url             = var.create_data_services ? "rediss://${aws_elasticache_replication_group.main[0].primary_endpoint_address}:6379" : var.redis_url

  # PostgREST's login. On AWS built from the RDS endpoint; on floci passed in app_secrets.
  computed_secrets = var.create_data_services ? {
    PGRST_DB_URI = "postgres://authenticator:${urlencode(var.app_secrets["AUTHENTICATOR_PASSWORD"])}@${aws_db_instance.main[0].address}:${aws_db_instance.main[0].port}/qacc"
  } : {}
}
