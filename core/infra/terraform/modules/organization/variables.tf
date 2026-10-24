variable "us_prod_account_id" {
  description = "AWS Account ID for the US Production account"
  type        = string
}

variable "ca_prod_account_id" {
  description = "AWS Account ID for the Canada Production account"
  type        = string
}

variable "staging_account_id" {
  description = "AWS Account ID for the Staging account (test data only)"
  type        = string
  default     = null
}

variable "shared_services_account_id" {
  description = "AWS Account ID for Shared Services (ECR, Route 53, CI/CD)"
  type        = string
  default     = null
}

variable "us_allowed_region" {
  description = "Primary AWS region permitted for the US production account"
  type        = string
  default     = "us-east-1"
}

variable "ca_allowed_region" {
  description = "Primary AWS region permitted for the Canada production account"
  type        = string
  default     = "ca-central-1"
}
