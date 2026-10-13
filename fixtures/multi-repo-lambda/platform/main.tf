terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "lending-library-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "eu-west-1"
  }

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

variable "stage" {
  type    = string
  default = "dev"
}
