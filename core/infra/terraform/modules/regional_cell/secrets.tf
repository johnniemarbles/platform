/**
 * Regional Secrets Manager Resources
 *
 * Implements Scope-Token Dev -> Prod Cryptographic Cutover:
 * 1. Generates production Ed25519 keypair for scope tokens.
 * 2. Stores private key (read by platform-api task role only).
 * 3. Stores public key (read by hub-api task role only).
 * 4. Stores encrypted database connection string.
 */

# 1. Database Connection Secret
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name_prefix}/database_url"
  description             = "Postgres connection string for ${local.name_prefix}"
  recovery_window_in_days = 0

  tags = {
    Country     = var.country_code
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = jsonencode({
    DATABASE_URL = "postgres://${aws_db_instance.postgres.username}:${random_password.db_master_password.result}@${aws_db_instance.postgres.endpoint}/${aws_db_instance.postgres.db_name}?sslmode=require"
  })
}

# 2. Scope-Token Ed25519 Keypair (Prod Asymmetric Cryptography)
resource "tls_private_key" "scope_token" {
  algorithm = "ED25519"
}

# Private Key (for platform-api to sign scope tokens)
resource "aws_secretsmanager_secret" "scope_token_private" {
  name                    = "${local.name_prefix}/scope_token_ed25519_private"
  description             = "Ed25519 private key for platform-api scope-token signing"
  recovery_window_in_days = 0

  tags = {
    Country     = var.country_code
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "scope_token_private" {
  secret_id     = aws_secretsmanager_secret.scope_token_private.id
  secret_string = tls_private_key.scope_token.private_key_pem
}

# Public Key (for hub-api to verify scope tokens)
resource "aws_secretsmanager_secret" "scope_token_public" {
  name                    = "${local.name_prefix}/scope_token_ed25519_public"
  description             = "Ed25519 public key for hub-api scope-token verification"
  recovery_window_in_days = 0

  tags = {
    Country     = var.country_code
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "scope_token_public" {
  secret_id     = aws_secretsmanager_secret.scope_token_public.id
  secret_string = tls_private_key.scope_token.public_key_pem
}
