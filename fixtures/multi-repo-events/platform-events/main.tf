terraform {
  required_version = ">= 1.5"

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

# The bus every library service puts its events on, owned here and looked up
# by name everywhere else. Every library event is copied to an audit queue
# that no configured service reads.
module "library_bus" {
  source  = "terraform-aws-modules/eventbridge/aws"
  version = "~> 3.0"

  bus_name = "library"

  rules = {
    audit = {
      description   = "Every event a library service puts"
      event_pattern = jsonencode({ source = [{ prefix = "library." }] })
    }
  }

  targets = {
    audit = [
      {
        name = "audit-queue"
        arn  = aws_sqs_queue.audit.arn
      }
    ]
  }
}

resource "aws_sqs_queue" "audit" {
  name = "library-audit"
}

output "bus_name" {
  value = module.library_bus.eventbridge_bus_name
}
