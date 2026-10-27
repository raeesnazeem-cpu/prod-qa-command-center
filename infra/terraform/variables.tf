variable "env" {
  description = "Environment name: local (floci), staging, prod"
  type        = string
}

variable "use_floci" {
  description = "Point the AWS provider at floci on localhost:4566"
  type        = bool
  default     = false
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
