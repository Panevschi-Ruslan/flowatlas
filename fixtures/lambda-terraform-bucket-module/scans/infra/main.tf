terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
}

locals {
  prefix = "library-scans"

  handlers = {
    store-page       = "pages/store-page.handler"
    import-batch     = "pages/import-batch.handler"
    withdraw-page    = "pages/withdraw-page.handler"
    purge-version    = "pages/purge-version.handler"
    index-page       = "pages/index-page.handler"
    catalogue-import = "pages/catalogue-import.handler"
    note-withdrawal  = "pages/note-withdrawal.handler"
    forget-thumbs    = "pages/forget-thumbs.handler"
  }
}

data "archive_file" "scans" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/scans.zip"
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

resource "aws_lambda_function" "fn" {
  for_each = local.handlers

  function_name    = "${local.prefix}-${each.key}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = each.value
  filename         = data.archive_file.scans.output_path
  source_code_hash = data.archive_file.scans.output_base64sha256
}

# The scanned pages keep every version: a delete naming none leaves a marker.
resource "aws_s3_bucket" "pages" {
  bucket = "library-page-scans"
}

resource "aws_s3_bucket_versioning" "pages" {
  bucket = aws_s3_bucket.pages.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket" "thumbs" {
  bucket = "library-page-thumbs"
}

resource "aws_sqs_queue" "imports" {
  name = "library-scan-imports"
}

resource "aws_lambda_event_source_mapping" "catalogue_import" {
  event_source_arn = aws_sqs_queue.imports.arn
  function_name    = aws_lambda_function.fn["catalogue-import"].arn
}

resource "aws_sns_topic" "withdrawn" {
  name = "library-scan-withdrawn"
}

resource "aws_sns_topic_subscription" "note_withdrawal" {
  topic_arn = aws_sns_topic.withdrawn.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.fn["note-withdrawal"].arn
}

# The archive of withdrawn pages, through the s3-bucket module, keeps every
# version by its versioning input: a delete naming none leaves a marker, which
# is noted.
module "archive" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.0"

  bucket = "library-page-archive"

  versioning = {
    enabled = true
  }
}

resource "aws_s3_bucket_notification" "archive" {
  bucket = module.archive.s3_bucket_id

  lambda_function {
    id                  = "note-withdrawal"
    lambda_function_arn = aws_lambda_function.fn["note-withdrawal"].arn
    events              = ["s3:ObjectRemoved:DeleteMarkerCreated"]
    filter_prefix       = "pages/"
  }
}
