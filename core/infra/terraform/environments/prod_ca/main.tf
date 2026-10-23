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
  #   bucket         = "platform-tf-state-ca"
  #   key            = "prod_ca/terraform.tfstate"
  #   region         = "ca-central-1"
  #   encrypt        = true
  #   dynamodb_table = "platform-tf-lock-ca"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Platform    = "Operational"
      Cell        = "CA"
      Environment = "prod"
      ManagedBy   = "Terraform"
    }
  }
}

module "cell_ca" {
  source = "../../modules/regional_cell"

  country_code            = "CA"
  aws_region              = var.aws_region
  environment             = "prod"
  vpc_cidr                = "10.20.0.0/16"
  auth_domain             = var.auth_domain
  primary_app_id          = "app_insurance"
  hub_api_image           = var.hub_api_image
  platform_api_image      = var.platform_api_image
  db_instance_class       = "db.t4g.medium"
  db_allocated_storage    = 20
  backup_retention_period = 14
}

output "ca_vpc_id" {
  value = module.cell_ca.vpc_id
}

output "ca_database_endpoint" {
  value = module.cell_ca.database_endpoint
}

output "ca_cognito_user_pool_id" {
  value = module.cell_ca.cognito_user_pool_id
}

output "ca_cognito_client_id" {
  value = module.cell_ca.cognito_client_id
}

output "ca_alb_dns" {
  value = module.cell_ca.alb_dns_name
}
