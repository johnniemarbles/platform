variable "aws_region" {
  description = "AWS Region for Canada Prod"
  type        = string
  default     = "ca-central-1"
}

variable "auth_domain" {
  description = "Auth domain for Canada users (e.g., auth.ca.example.com)"
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
