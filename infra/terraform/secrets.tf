# One JSON secret; containers pick keys with valueFrom "<arn>:<KEY>::".
resource "aws_secretsmanager_secret" "app" {
  name                    = "qacc/${var.env}/app"
  recovery_window_in_days = var.use_floci ? 0 : 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(var.app_secrets)
}

locals {
  secret_ref = { for k in nonsensitive(keys(var.app_secrets)) : k => "${aws_secretsmanager_secret.app.arn}:${k}::" }
}
