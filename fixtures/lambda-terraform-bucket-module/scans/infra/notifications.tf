# The pages bucket's notification, through the s3-bucket module's submodule:
# a page joined under pages/ is indexed, a batch completed in parts under
# imports/ is queued for the catalogue, and a delete marker is announced.
module "pages_notification" {
  source  = "terraform-aws-modules/s3-bucket/aws//modules/notification"
  version = "~> 4.0"

  bucket = aws_s3_bucket.pages.id

  lambda_notifications = {
    index-page = {
      function_arn  = aws_lambda_function.fn["index-page"].arn
      function_name = aws_lambda_function.fn["index-page"].function_name
      events        = ["s3:ObjectCreated:*"]
      filter_prefix = "pages/"
    }
  }

  sqs_notifications = {
    catalogue-import = {
      queue_arn     = aws_sqs_queue.imports.arn
      queue_id      = aws_sqs_queue.imports.id
      events        = ["s3:ObjectCreated:CompleteMultipartUpload"]
      filter_prefix = "imports/"
    }
  }

  sns_notifications = {
    withdrawn = {
      topic_arn = aws_sns_topic.withdrawn.arn
      events    = ["s3:ObjectRemoved:DeleteMarkerCreated"]
    }
  }
}
