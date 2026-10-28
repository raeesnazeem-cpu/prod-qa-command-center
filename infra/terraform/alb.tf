resource "aws_lb" "main" {
  name               = "qacc-${var.env}-alb"
  load_balancer_type = "application"
  subnets            = local.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  # TED webhooks can take a while to answer.
  idle_timeout = 120
}

resource "aws_lb_target_group" "web" {
  name        = "qacc-${var.env}-web"
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id

  health_check {
    path    = "/healthz"
    matcher = "200"
  }
}

resource "aws_lb_target_group" "api" {
  name        = "qacc-${var.env}-api"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id

  health_check {
    path    = "/api/health"
    matcher = "200"
  }
}

# HTTPS (AWS): one ACM certificate for web_host + api_host. Validation is by DNS:
# Terraform outputs the CNAME records (output acm_validation_records); whoever runs
# the DNS adds them, then aws_acm_certificate_validation finishes. See
# infra/README.md step "HTTPS certificate".
resource "aws_acm_certificate" "main" {
  count                     = var.https_enabled ? 1 : 0
  domain_name               = var.web_host
  subject_alternative_names = [var.api_host]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "main" {
  count           = var.https_enabled ? 1 : 0
  certificate_arn = aws_acm_certificate.main[0].arn
}

resource "aws_lb_listener" "https" {
  count             = var.https_enabled ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main[0].certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

# HTTP: redirects to HTTPS when it is on; otherwise (floci) it serves the app.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  default_action {
    type = var.https_enabled ? "redirect" : "fixed-response"

    dynamic "redirect" {
      for_each = var.https_enabled ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "fixed_response" {
      for_each = var.https_enabled ? [] : [1]
      content {
        content_type = "text/plain"
        message_body = "Not found"
        status_code  = "404"
      }
    }
  }
}

locals {
  app_listener_arn = var.https_enabled ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = local.app_listener_arn
  priority     = 10

  condition {
    host_header {
      values = [var.api_host]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener_rule" "web" {
  listener_arn = local.app_listener_arn
  priority     = 20

  condition {
    host_header {
      values = [var.web_host]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}
