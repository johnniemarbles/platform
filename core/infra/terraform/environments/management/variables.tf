variable "us_prod_account_id" {
  description = "AWS Account ID for US Prod"
  type        = string
}

variable "ca_prod_account_id" {
  description = "AWS Account ID for Canada Prod"
  type        = string
}

variable "staging_account_id" {
  description = "AWS Account ID for Staging"
  type        = string
  default     = null
}

variable "shared_services_account_id" {
  description = "AWS Account ID for Shared Services"
  type        = string
  default     = null
}
