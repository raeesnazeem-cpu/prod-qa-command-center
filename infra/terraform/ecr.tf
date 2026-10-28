locals {
  repos = ["qacc-api", "qacc-worker", "qacc-web", "qacc-dbtools", "postgrest"]
}

resource "aws_ecr_repository" "this" {
  for_each             = toset(local.repos)
  name                 = "${var.ecr_repo_prefix}${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.use_floci

  image_scanning_configuration {
    scan_on_push = true
  }
}

locals {
  image = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}
