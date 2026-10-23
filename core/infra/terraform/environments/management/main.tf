terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1" # Management root / global services

  default_tags {
    tags = {
      Platform  = "Management"
      ManagedBy = "Terraform"
    }
  }
}

module "org" {
  source = "../../modules/organization"

  us_prod_account_id         = var.us_prod_account_id
  ca_prod_account_id         = var.ca_prod_account_id
  staging_account_id         = var.staging_account_id
  shared_services_account_id = var.shared_services_account_id
  us_allowed_region          = "us-east-1"
  ca_allowed_region          = "ca-central-1"
}

output "organization_id" {
  value = module.org.organization_id
}

output "us_scp_id" {
  value = module.org.us_region_deny_policy_id
}

output "ca_scp_id" {
  value = module.org.ca_region_deny_policy_id
}
