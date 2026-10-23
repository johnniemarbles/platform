variable "country_code" {
  description = "ISO-3166-1 alpha-2 country code (e.g., US, CA)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for this country cell (e.g., us-east-1, ca-central-1)"
  type        = string
}

variable "environment" {
  description = "Deployment environment (prod, staging)"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the regional VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "auth_domain" {
  description = "Domain name for authentication emails and endpoints (e.g. auth.us.example.com)"
  type        = string
}

variable "hub_api_image" {
  description = "Container image URI for hub-api"
  type        = string
  default     = "platform-hub-api:latest"
}

variable "platform_api_image" {
  description = "Container image URI for platform-api"
  type        = string
  default     = "platform-core-api:latest"
}

variable "db_instance_class" {
  description = "RDS PostgreSQL instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB for RDS PostgreSQL"
  type        = number
  default     = 20
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups (minimum 7 for PITR)"
  type        = number
  default     = 14
}

variable "primary_app_id" {
  description = "Primary platform app ID running in this cell (e.g. app_dentex, app_insurance)"
  type        = string
  default     = "app_platform"
}

variable "allowed_cors_origins" {
  description = "Allowed origins for CORS"
  type        = list(string)
  default     = ["*"]
}
