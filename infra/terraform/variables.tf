variable "env" {
  description = "Environment name: local (floci), staging, prod"
  type        = string
}

variable "use_floci" {
  description = "Point the AWS provider at floci on localhost:4566"
  type        = bool
  default     = false
}

variable "floci_endpoint" {
  description = "floci URL (http://floci:4566 when Terraform runs on the floci Docker network)"
  type        = string
  default     = "http://localhost:4566"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "domain" {
  description = "Base domain; web = qacc.<domain>, api = api.qacc.<domain>"
  type        = string
  default     = "qacc.localhost"
}

# Task sizes (plan §4). Worker is Playwright-heavy; scale size before count.
variable "web_cpu" {
  type    = number
  default = 256
}
variable "web_memory" {
  type    = number
  default = 512
}
variable "api_cpu" {
  type    = number
  default = 512
}
variable "api_memory" {
  type    = number
  default = 1024
}
variable "worker_cpu" {
  type    = number
  default = 2048
}
variable "worker_memory" {
  type    = number
  default = 4096
}
variable "recorder_cpu" {
  type    = number
  default = 1024
}
variable "recorder_memory" {
  type    = number
  default = 2048
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "postgrest_image_tag" {
  description = "Pinned PostgREST version for the sidecar"
  type        = string
  default     = "v12.2.12"
}

# --- Phase 6: services ------------------------------------------------------

variable "image_tag" {
  description = "Tag of the qacc-api / qacc-web / qacc-worker images in ECR"
  type        = string
}

variable "vpc_id" {
  description = "VPC for the ALB and tasks (floci: vpc-default-us-east-1; AWS: network.tf in Phase 8)"
  type        = string
}

variable "public_subnet_ids" {
  description = "Subnets for the ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnets for ECS tasks (no public IP; NAT for egress on AWS)"
  type        = list(string)
}

# Data services, still created outside Terraform until Phase 8 (rds.tf, redis.tf, s3.tf).
# The DB address lives in app_secrets.PGRST_DB_URI.
variable "redis_url" {
  description = "redis:// (floci) or rediss:// (ElastiCache in-transit encryption)"
  type        = string
}
variable "media_bucket" {
  type = string
}
variable "media_public_base_url" {
  description = "Browser-facing base for stored media (CloudFront on AWS; floci S3 locally)"
  type        = string
}

variable "web_host" {
  description = "Host the ALB routes to web, e.g. qacc.<domain>"
  type        = string
}
variable "api_host" {
  description = "Host the ALB routes to api, e.g. api.qacc.<domain>"
  type        = string
}
variable "alb_listener_port" {
  description = "HTTP listener port (floci maps container :80 to host :8088). HTTPS+ACM comes in Phase 8."
  type        = number
  default     = 80
}
variable "public_web_url" {
  description = "Browser URL of the web app (CORS + SSO return), e.g. https://qacc.<domain>"
  type        = string
}

variable "system_org_id" {
  type = string
}
variable "system_user_id" {
  type = string
}
variable "ted_preview_only" {
  description = "true = TED writes go to local ted_comments only"
  type        = bool
  default     = true
}

variable "app_secrets" {
  description = <<-EOT
    Values stored in Secrets Manager qacc/<env>/app and injected into containers:
    PGRST_DB_URI, PGRST_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY (HS256 JWT role=service_role
    signed with PGRST_JWT_SECRET), TED_SSO_SECRET, QACC_SESSION_SECRET, TED_WEBHOOK_SECRET,
    X_API_KEY, TED_API_TOKEN. Extra keys (AI keys etc.) are injected too.
  EOT
  type        = map(string)
  sensitive   = true
}

variable "extra_app_secrets" {
  description = "More keys for the app secret (AI/TED/check keys). Kept out of app_secrets so a generated, gitignored *.auto.tfvars.json can supply them."
  type        = map(string)
  sensitive   = true
  default     = {}
}
