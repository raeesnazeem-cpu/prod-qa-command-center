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
variable "cpu_architecture" {
  description = "ARM64 (Graviton, ~20% cheaper; images built on Apple Silicon match) or X86_64. Build images for the same platform (infra/aws/03-build-push.sh)."
  type        = string
  default     = "ARM64"
}

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
# Worker autoscaling: one worker task per run in flight, between min and max.
# max is also the number of runs allowed at once (RUN_SLOT_LIMIT). min = max
# turns autoscaling off. min 0 saves money but the first run waits ~3-5 min.
variable "worker_min_count" {
  type    = number
  default = 1
}
variable "worker_max_count" {
  type    = number
  default = 1
}
variable "recording_enabled" {
  description = "Video recording barrier: start recorder tasks (VIDEO_RECORDING_ENABLED)"
  type        = bool
  default     = false
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

# --- What Terraform creates ----------------------------------------------------
# AWS: leave both true (Terraform builds the network, database, Redis, bucket, CDN).
# floci "local": both false — it reuses floci's default VPC and the RDS / Redis /
# bucket made by hand in Phases 1-2, passed in through the variables below.

variable "create_network" {
  description = "Create VPC, subnets, NAT gateway (true on AWS)"
  type        = bool
  default     = true
}

variable "create_data_services" {
  description = "Create RDS, ElastiCache, the media bucket and its CloudFront CDN (true on AWS)"
  type        = bool
  default     = true
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

# Only used when create_network = false.
variable "vpc_id" {
  description = "Existing VPC (floci: vpc-default-us-east-1)"
  type        = string
  default     = null
}
variable "public_subnet_ids" {
  description = "Existing subnets for the ALB"
  type        = list(string)
  default     = []
}
variable "private_subnet_ids" {
  description = "Existing subnets for ECS tasks"
  type        = list(string)
  default     = []
}

# Only used when create_data_services = false. On AWS these come from data.tf, and
# PGRST_DB_URI is built from the RDS endpoint + app_secrets.AUTHENTICATOR_PASSWORD.
variable "redis_url" {
  description = "redis:// (floci) or rediss:// (ElastiCache in-transit encryption)"
  type        = string
  default     = null
}
variable "media_bucket" {
  description = "Media bucket name. On AWS optional: default qacc-media-<env>-<account id>"
  type        = string
  default     = null
}
variable "media_public_base_url" {
  description = "Browser-facing base for stored media (floci S3 locally; CloudFront on AWS is automatic)"
  type        = string
  default     = null
}

variable "db_allocated_storage" {
  description = "RDS disk in GB (grows automatically up to 5x)"
  type        = number
  default     = 20
}
variable "db_backup_retention_days" {
  type    = number
  default = 7
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
  description = "HTTP listener port (floci maps container :80 to host :8088)"
  type        = number
  default     = 80
}
variable "https_enabled" {
  description = "Add the HTTPS :443 listener with an ACM certificate for web_host + api_host; HTTP then redirects. Needs the DNS validation records (see the handover guide)."
  type        = bool
  default     = false
}
variable "public_web_url" {
  description = "Browser URL of the web app (CORS + SSO return), e.g. https://qacc.<domain>"
  type        = string
}
variable "worker_api_url" {
  description = "API address the worker uses for its backup TED comment route (/internal/ted-comment) when X_API_KEY is refused. Empty = built from api_host (https when https_enabled). On floci leave empty: the route is off there and comments rely on X_API_KEY."
  type        = string
  default     = ""
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
    X_API_KEY, TED_API_TOKEN, RECORDING_TRIGGER_TOKEN; on AWS also AUTHENTICATOR_PASSWORD
    (PostgREST's DB login; Terraform builds PGRST_DB_URI from it, so leave PGRST_DB_URI
    out). Extra keys (AI keys etc.) are injected too. infra/aws/make-secrets.mjs writes them.
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

variable "ted_base_url" {
  description = "TED app URL for the login button. Baked into the web image by infra/aws/03-build-push.sh (not used by Terraform itself)."
  type        = string
  default     = ""
}

variable "ecr_repo_prefix" {
  description = "Prefix for the ECR repository names. Leave empty; set only when two stacks share one AWS account (e.g. \"staging-\")."
  type        = string
  default     = ""
}
