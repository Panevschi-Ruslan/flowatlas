provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "kiosk" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/kiosk.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-branch-kiosk-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "status_board" {
  function_name = "library-branch-kiosk-status-board"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "kiosk/status-board.handler"
  filename      = data.archive_file.kiosk.output_path

  environment {
    variables = {
      LOANS_API_URL  = "https://loans.branch.library.example"
      EVENTS_API_URL = "https://events.branch.library.example"
      BRANCH_URL     = "https://branch.library.example"
      STAFF_LB_URL   = "https://staff.branch.library.example"
      DESK_HOURS_URL = "https://desk.branch.library.example"
    }
  }
}
