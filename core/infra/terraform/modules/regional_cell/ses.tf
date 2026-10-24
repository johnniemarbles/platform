/**
 * SES Dedicated Authentication Configuration Set
 *
 * Implements Plan Non-Negotiable #4:
 * Sign-in codes go through each region's own SES, never through the hub.
 * Dedicated configuration set isolates sign-in reputation from marketing mail.
 */

resource "aws_ses_domain_identity" "auth" {
  domain = var.auth_domain
}

resource "aws_ses_configuration_set" "auth_signin" {
  name = "${local.name_prefix}-ses-auth-config-set"

  delivery_options {
    tls_policy = "Require"
  }

  reputation_metrics_enabled = true
}

resource "aws_ses_identity_policy" "cognito_send" {
  identity = aws_ses_domain_identity.auth.arn
  name     = "${local.name_prefix}-cognito-ses-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "cognito-idp.amazonaws.com" }
        Action    = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource  = aws_ses_domain_identity.auth.arn
      }
    ]
  })
}
