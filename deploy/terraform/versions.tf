terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # For a real deployment, pin state to S3 + DynamoDB. Example:
  #
  # backend "s3" {
  #   bucket         = "procela-tfstate-<account-id>"
  #   key            = "procela/dev/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "procela-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront-related resources (ACM certs used by CloudFront, WAFv2 CLOUDFRONT scope)
# must be created in us-east-1. We do not currently use it for the ACM cert
# (that's an input variable, so the customer manages it in the correct region),
# but the alias is here so future WAF / cert resources can attach to it.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
