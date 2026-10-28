# One JSON secret; containers pick keys with valueFrom "<arn>:<KEY>::".
resource "aws_secretsmanager_secret" "app" {
  name                    = "qacc/${var.env}/app"
  recovery_window_in_days = var.use_floci ? 0 : 7
}

locals {
  all_app_secrets = merge(var.app_secrets, var.extra_app_secrets, local.computed_secrets)
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.all_app_secrets)
}

locals {
  secret_ref = { for k in nonsensitive(keys(local.all_app_secrets)) : k => "${aws_secretsmanager_secret.app.arn}:${k}::" }
}
