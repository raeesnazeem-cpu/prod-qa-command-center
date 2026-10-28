resource "aws_security_group" "alb" {
  name        = "qacc-${var.env}-alb"
  description = "QACC ALB"
  vpc_id      = local.vpc_id

  ingress {
    description = "HTTP"
    from_port   = var.alb_listener_port
    to_port     = var.alb_listener_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Tasks: only the ALB reaches web :80 and api :3001. PostgREST :3000 listens on
# 127.0.0.1 inside each task, so nothing outside the task can reach it.
resource "aws_security_group" "tasks" {
  name        = "qacc-${var.env}-tasks"
  description = "QACC ECS tasks"
  vpc_id      = local.vpc_id

  ingress {
    description     = "ALB to web/api"
    from_port       = 80
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # floci's ALB data plane runs inside the floci container, not on an ENI in the
  # ALB security group, so allow the Docker network there. Not created on AWS.
  dynamic "ingress" {
    for_each = var.use_floci ? [1] : []
    content {
      description = "floci ALB data plane"
      from_port   = 80
      to_port     = 3001
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    description = "Scanned sites, AI providers, TED, RDS, Redis, S3"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
