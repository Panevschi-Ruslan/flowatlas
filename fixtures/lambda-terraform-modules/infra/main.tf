terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

locals {
  handlers = "${path.module}/../src/handlers"
}

# Through the repository's own module.
module "get_title" {
  source = "./modules/function"

  name       = "catalogue-get-title"
  handler    = "get-title.handler"
  source_dir = local.handlers
}

# Through the public module, which ships described.
module "search_titles" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 7.0"

  function_name = "catalogue-search-titles"
  handler       = "search-titles.handler"
  runtime       = "nodejs20.x"
  source_path   = local.handlers
}

module "register_borrower" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 7.0"

  function_name = "catalogue-register-borrower"
  handler       = "register-borrower.handler"
  runtime       = "nodejs20.x"

  source_path = [{
    path     = local.handlers
    commands = ["npm ci", "npm run build", ":zip"]
  }]
}

module "get_borrower" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 7.0"

  function_name = "catalogue-get-borrower"
  handler       = "get-borrower.handler"
  runtime       = "nodejs20.x"
  source_path   = local.handlers
}

# A team module from another repository, with no description anywhere: nothing
# it declares can be read, and the row says what to describe.
module "newsletter" {
  source = "git::https://git.example.com/library-platform/terraform-scheduled-function.git?ref=v1.4.0"

  function_name = "catalogue-send-newsletter"
  handler       = "send-newsletter.handler"
  source_dir    = local.handlers
  schedule      = "cron(0 8 ? * MON *)"
}
