# A cover created under incoming/ makes a thumbnail; a thumbnail created under
# thumbnails/ is queued for the index. Removing an object notifies nobody.
resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    id                  = "make-thumbnail"
    lambda_function_arn = aws_lambda_function.make_thumbnail.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "incoming/"
    filter_suffix       = ".png"
  }

  queue {
    id            = "index-thumbnail"
    queue_arn     = aws_sqs_queue.thumbnails.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "thumbnails/"
  }
}

resource "aws_lambda_event_source_mapping" "index_thumbnail" {
  event_source_arn = aws_sqs_queue.thumbnails.arn
  function_name    = aws_lambda_function.index_thumbnail.arn
}

# The archive sends everything to the default bus, where a rule takes what is created.
resource "aws_s3_bucket_notification" "archive" {
  bucket      = aws_s3_bucket.archive.id
  eventbridge = true
}

resource "aws_cloudwatch_event_rule" "cover_archived" {
  name = "library-cover-archived"
  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.archive.id] }
    }
  })
}

resource "aws_cloudwatch_event_target" "cover_archived" {
  rule = aws_cloudwatch_event_rule.cover_archived.name
  arn  = aws_lambda_function.record_archived.arn
}
