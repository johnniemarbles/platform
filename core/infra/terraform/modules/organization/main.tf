/**
 * AWS Organization & Region-Deny Service Control Policies (SCPs)
 *
 * Implements Plan V3.1 Non-Negotiables:
 * 1. Single AWS Organization with all features enabled (required for SCPs).
 * 2. Dedicated account per country cell (US Prod, Canada Prod).
 * 3. Region-deny SCP attached to each country account blocking any region but its own,
 *    strictly exempting AWS global services: IAM, STS, CloudFront, Route 53, Support,
 *    Organizations, Budgets, Cost Explorer, and Health.
 */

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# 1. AWS Organization Structure
resource "aws_organizations_organizational_unit" "prod" {
  name      = "Prod"
  parent_id = data.aws_organizations_organization.current.roots[0].id
}

resource "aws_organizations_organizational_unit" "staging" {
  name      = "Staging"
  parent_id = data.aws_organizations_organization.current.roots[0].id
}

resource "aws_organizations_organizational_unit" "shared_services" {
  name      = "SharedServices"
  parent_id = data.aws_organizations_organization.current.roots[0].id
}

data "aws_organizations_organization" "current" {}

# 2. Region-Deny SCP: USA Prod Account
resource "aws_organizations_policy" "region_deny_us" {
  name        = "DenyAllOutsideUS-${var.us_allowed_region}"
  description = "Blocks any AWS operation outside ${var.us_allowed_region} for US Prod, exempting global services."
  type        = "SERVICE_CONTROL_POLICY"

  content = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyAllOutsideUS"
        Effect = "Deny"
        NotAction = [
          "iam:*",
          "sts:*",
          "cloudfront:*",
          "route53:*",
          "route53domains:*",
          "support:*",
          "organizations:*",
          "account:*",
          "budgets:*",
          "ce:*",
          "health:*"
        ]
        Resource = "*"
        Condition = {
          StringNotEquals = {
            "aws:RequestedRegion" = [var.us_allowed_region]
          }
        }
      }
    ]
  })
}

# 3. Region-Deny SCP: Canada Prod Account
resource "aws_organizations_policy" "region_deny_ca" {
  name        = "DenyAllOutsideCanada-${var.ca_allowed_region}"
  description = "Blocks any AWS operation outside ${var.ca_allowed_region} for Canada Prod, exempting global services."
  type        = "SERVICE_CONTROL_POLICY"

  content = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyAllOutsideCanada"
        Effect = "Deny"
        NotAction = [
          "iam:*",
          "sts:*",
          "cloudfront:*",
          "route53:*",
          "route53domains:*",
          "support:*",
          "organizations:*",
          "account:*",
          "budgets:*",
          "ce:*",
          "health:*"
        ]
        Resource = "*"
        Condition = {
          StringNotEquals = {
            "aws:RequestedRegion" = [var.ca_allowed_region]
          }
        }
      }
    ]
  })
}

# 4. Attach Region-Deny SCP to US Prod Account
resource "aws_organizations_policy_attachment" "us_prod_region_deny" {
  policy_id = aws_organizations_policy.region_deny_us.id
  target_id = var.us_prod_account_id
}

# 5. Attach Region-Deny SCP to Canada Prod Account
resource "aws_organizations_policy_attachment" "ca_prod_region_deny" {
  policy_id = aws_organizations_policy.region_deny_ca.id
  target_id = var.ca_prod_account_id
}
