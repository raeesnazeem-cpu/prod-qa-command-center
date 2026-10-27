resource "aws_lb" "main" {
  name               = "qacc-${var.env}-alb"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  # TED webhooks can take a while to answer.
  idle_timeout = 120
}

resource "aws_lb_target_group" "web" {
  name        = "qacc-${var.env}-web"
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

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
  vpc_id      = var.vpc_id

  health_check {
    path    = "/api/health"
    matcher = "200"
  }
}

# Plain HTTP for floci. Phase 8 adds the 443 listener with the ACM cert and turns
# this one into a redirect.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
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
  listener_arn = aws_lb_listener.http.arn
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
