terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # In production, state is backed by an in-region S3 bucket with KMS encryption
  # backend "s3" {
  #   bucket         = "platform-tf-state-us"
  #   key            = "prod_us/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "platform-tf-lock-us"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Platform    = "Operational"
      Cell        = "US"
      Environment = "prod"
      ManagedBy   = "Terraform"
    }
  }
}

module "cell_us" {
  source = "../../modules/regional_cell"

  country_code            = "US"
  aws_region              = var.aws_region
  environment             = "prod"
  vpc_cidr                = "10.10.0.0/16"
  auth_domain             = var.auth_domain
  primary_app_id          = "app_dentex"
  hub_api_image           = var.hub_api_image
  platform_api_image      = var.platform_api_image
  db_instance_class       = "db.t4g.medium"
  db_allocated_storage    = 20
  backup_retention_period = 14
}

output "us_vpc_id" {
  value = module.cell_us.vpc_id
}

output "us_database_endpoint" {
  value = module.cell_us.database_endpoint
}

output "us_cognito_user_pool_id" {
  value = module.cell_us.cognito_user_pool_id
}

output "us_cognito_client_id" {
  value = module.cell_us.cognito_client_id
}

output "us_alb_dns" {
  value = module.cell_us.alb_dns_name
}
