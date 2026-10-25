resource "aws_lambda_function" "staff_plain_health" {
  function_name = "library-branch-staff-plain-health"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "health/staff-plain-health.handler"
  filename      = data.archive_file.branch.output_path
}

resource "aws_lambda_function" "desk_hours" {
  function_name = "library-branch-desk-hours"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "hours/desk-hours.handler"
  filename      = data.archive_file.branch.output_path
}

resource "aws_lambda_function" "lab_hours" {
  function_name = "library-branch-lab-hours"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "hours/lab-hours.handler"
  filename      = data.archive_file.branch.output_path
}
