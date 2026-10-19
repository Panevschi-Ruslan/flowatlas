# A plain-HTTP listener on each load balancer (P61). The staff one sends
# `GET /health` to a function of its own, so its two listeners are two routes;
# the public one sends it to the same target group as its HTTPS listener, so
# it stays one route.
resource "aws_lb_target_group" "staff_plain_health" {
  name        = "library-staff-plain-health"
  target_type = "lambda"
}

resource "aws_lb_target_group_attachment" "staff_plain_health" {
  target_group_arn = aws_lb_target_group.staff_plain_health.arn
  target_id        = aws_lambda_function.staff_plain_health.arn
}

resource "aws_lb_listener" "staff_plain" {
  load_balancer_arn = aws_lb.staff.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "staff_plain_health" {
  listener_arn = aws_lb_listener.staff_plain.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.staff_plain_health.arn
  }

  condition {
    path_pattern {
      values = ["/health"]
    }
  }

  condition {
    http_request_method {
      values = ["GET"]
    }
  }
}

resource "aws_lb_listener" "public_plain" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "public_plain_health" {
  listener_arn = aws_lb_listener.public_plain.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.public_health.arn
  }

  condition {
    path_pattern {
      values = ["/health"]
    }
  }

  condition {
    http_request_method {
      values = ["GET"]
    }
  }
}
