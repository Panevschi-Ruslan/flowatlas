# Two load balancers, each forwarding `GET /health` to a function of its own.
resource "aws_lb" "staff" {
  name               = "library-staff-lb"
  load_balancer_type = "application"
}

resource "aws_lb_target_group" "staff_health" {
  name        = "library-staff-health"
  target_type = "lambda"
}

resource "aws_lb_target_group_attachment" "staff_health" {
  target_group_arn = aws_lb_target_group.staff_health.arn
  target_id        = aws_lambda_function.staff_health.arn
}

resource "aws_lb_listener" "staff" {
  load_balancer_arn = aws_lb.staff.arn
  port              = 443
  protocol          = "HTTPS"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "staff_health" {
  listener_arn = aws_lb_listener.staff.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.staff_health.arn
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

resource "aws_lb" "public" {
  name               = "library-public-lb"
  load_balancer_type = "application"
}

resource "aws_lb_target_group" "public_health" {
  name        = "library-public-health"
  target_type = "lambda"
}

resource "aws_lb_target_group_attachment" "public_health" {
  target_group_arn = aws_lb_target_group.public_health.arn
  target_id        = aws_lambda_function.public_health.arn
}

resource "aws_lb_listener" "public" {
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "public_health" {
  listener_arn = aws_lb_listener.public.arn
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
