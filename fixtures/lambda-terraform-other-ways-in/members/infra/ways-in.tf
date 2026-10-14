# A function URL: any verb, any path, straight to the function.
resource "aws_lambda_function_url" "card_lookup" {
  function_name      = aws_lambda_function.fn["card-lookup"].function_name
  authorization_type = "NONE"
}

# A user pool runs a function at two steps of signing a member up.
resource "aws_cognito_user_pool" "members" {
  name = "library-members"

  lambda_config {
    pre_sign_up       = aws_lambda_function.fn["pre-sign-up"].arn
    post_confirmation = aws_lambda_function.fn["post-confirmation"].arn
  }
}

# Shelf sensors publish over IoT; one rule runs a function and queues a copy.
resource "aws_sqs_queue" "shelf_readings" {
  name = "library-shelf-readings"
}

resource "aws_iot_topic_rule" "shelf_weight" {
  name        = "library_shelf_weight"
  enabled     = true
  sql         = "SELECT * FROM 'library/shelves/+/weight'"
  sql_version = "2016-03-23"

  lambda {
    function_arn = aws_lambda_function.fn["shelf-sensor"].arn
  }

  sqs {
    queue_url  = aws_sqs_queue.shelf_readings.id
    role_arn   = aws_iam_role.lambda.arn
    use_base64 = false
  }
}

# A load balancer in front of the kiosk function, by path, verb and host.
resource "aws_lb" "kiosk" {
  name               = "library-kiosk"
  load_balancer_type = "application"
}

resource "aws_lb_target_group" "kiosk" {
  name        = "library-kiosk"
  target_type = "lambda"
}

resource "aws_lb_target_group_attachment" "kiosk" {
  target_group_arn = aws_lb_target_group.kiosk.arn
  target_id        = aws_lambda_function.fn["kiosk"].arn
}

resource "aws_lb_listener" "kiosk" {
  load_balancer_arn = aws_lb.kiosk.arn
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

resource "aws_lb_listener_rule" "kiosk_checkout" {
  listener_arn = aws_lb_listener.kiosk.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.kiosk.arn
  }

  condition {
    path_pattern {
      values = ["/kiosk/checkout"]
    }
  }

  condition {
    http_request_method {
      values = ["POST"]
    }
  }

  condition {
    host_header {
      values = ["kiosk.library.example"]
    }
  }
}

# Logs run this function, and nothing here reads what sends them.
resource "aws_lambda_permission" "log_digest" {
  statement_id  = "AllowLogs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["log-digest"].function_name
  principal     = "logs.amazonaws.com"
}

# Already read from the user pool: no row.
resource "aws_lambda_permission" "pre_sign_up" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["pre-sign-up"].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.members.arn
}
