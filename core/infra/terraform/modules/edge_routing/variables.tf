variable "root_domain" {
  description = "Root domain for tenant workspaces (e.g., yourdomain.com)"
  type        = string
}

variable "us_alb_dns" {
  description = "DNS endpoint of the US regional Application Load Balancer"
  type        = string
}

variable "ca_alb_dns" {
  description = "DNS endpoint of the Canada regional Application Load Balancer"
  type        = string
}
