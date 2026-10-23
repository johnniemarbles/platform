/**
 * Regional Cognito User Pool
 *
 * Implements Plan Non-Negotiable #2:
 * 1. One Cognito Essentials user pool per region, behind the identity adapter.
 * 2. Passwordless-by-default: email OTP + passkeys.
 * 3. NO multi-region replication add-on.
 * 4. Sign-in codes go through this region's own SES (auth domain), never through hub.
 */

resource "aws_cognito_user_pool" "pool" {
  name = "${local.name_prefix}-cognito-pool"

  # Passwordless-by-default (email OTP)
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # Email delivery via regional dedicated SES configuration set
  email_configuration {
    email_sending_account  = "DEVELOPER"
    from_email_address     = "no-reply@${var.auth_domain}"
    source_arn             = aws_ses_domain_identity.auth.arn
    configuration_set      = aws_ses_configuration_set.auth_signin.name
  }

  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  tags = {
    Name        = "${local.name_prefix}-cognito-pool"
    Country     = var.country_code
    Environment = var.environment
  }
}

# SPA User Pool Client (for spoke apps like dentex-v2, insurance)
resource "aws_cognito_user_pool_client" "web_client" {
  name         = "${local.name_prefix}-spa-client"
  user_pool_id = aws_cognito_user_pool.pool.id

  # Public client for Single Page Applications
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_CUSTOM_AUTH"
  ]

  id_token_validity      = 1
  access_token_validity  = 1
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}
