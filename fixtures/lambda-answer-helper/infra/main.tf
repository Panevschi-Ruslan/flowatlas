terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  description = "Region the scheme is deployed to."
  type        = string
  default     = "eu-west-1"
}

variable "stage" {
  description = "Deployment stage, part of every name."
  type        = string
  default     = "dev"
}

locals {
  prefix = "bikes-${var.stage}"
}
