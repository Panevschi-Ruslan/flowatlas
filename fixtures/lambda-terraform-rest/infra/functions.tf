data "archive_file" "loans" {
  type        = "zip"
  source_dir  = "${path.module}/../src/loans"
  output_path = "${path.module}/build/loans.zip"
}

# Returns are packaged from the compiled output rather than from the source.
data "archive_file" "returns" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/returns"
  output_path = "${path.module}/build/returns.zip"
}

data "archive_file" "reminders" {
  type        = "zip"
  source_dir  = "${path.module}/../src/reminders"
  output_path = "${path.module}/build/reminders.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "create_loan" {
  function_name    = "${local.prefix}-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-loan.handler"
  filename         = data.archive_file.loans.output_path
  source_code_hash = data.archive_file.loans.output_base64sha256

  environment {
    variables = {
      LOAN_DAYS = "21"
    }
  }
}

resource "aws_lambda_function" "get_loan" {
  function_name    = "${local.prefix}-get-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-loan.handler"
  filename         = data.archive_file.loans.output_path
  source_code_hash = data.archive_file.loans.output_base64sha256
}

resource "aws_lambda_function" "renew_loan" {
  function_name    = format("%s-%s", local.prefix, "renew-loan")
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "renew-loan.handler"
  filename         = data.archive_file.loans.output_path
  source_code_hash = data.archive_file.loans.output_base64sha256
}

resource "aws_lambda_function" "record_return" {
  function_name    = "${local.prefix}-record-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "record-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256
}

# One reminder function per channel. Which channels there are is decided when
# the deployment is run, so neither the functions' number nor their names can
# be read from these files.
resource "aws_lambda_function" "send_reminder" {
  for_each = toset(var.reminder_channels)

  function_name    = "${local.prefix}-remind-${each.key}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "send-reminder.handler"
  filename         = data.archive_file.reminders.output_path
  source_code_hash = data.archive_file.reminders.output_base64sha256

  environment {
    variables = {
      CHANNEL = each.key
    }
  }
}
