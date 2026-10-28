resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(["api", "worker", "web", "recorder", "dbtools"])
  name              = "/ecs/qacc-${var.env}-${each.key}"
  retention_in_days = 14
}
