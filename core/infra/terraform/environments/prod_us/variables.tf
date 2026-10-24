variable "aws_region" {
  description = "AWS Region for US Prod"
  type        = string
  default     = "us-east-1"
}

variable "auth_domain" {
  description = "Auth domain for US users (e.g., auth.us.example.com)"
  type        = string
}

variable "hub_api_image" {
  description = "Container image for hub-api"
  type        = string
  default     = "platform-hub-api:latest"
}

variable "platform_api_image" {
  description = "Container image for platform-api"
  type        = string
  default     = "platform-core-api:latest"
}
