output "vpc_id" {
  description = "The ID of the cell VPC"
  value       = aws_vpc.cell.id
}

output "database_endpoint" {
  description = "Endpoint of the RDS PostgreSQL instance"
  value       = aws_db_instance.postgres.endpoint
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID for this region"
  value       = aws_cognito_user_pool.pool.id
}

output "cognito_client_id" {
  description = "Cognito SPA Client ID for this region"
  value       = aws_cognito_user_pool_client.web_client.id
}

output "alb_dns_name" {
  description = "DNS name of the regional Application Load Balancer"
  value       = aws_lb.alb.dns_name
}

output "scope_token_public_key_pem" {
  description = "Public key for Ed25519 scope token verification"
  value       = tls_private_key.scope_token.public_key_pem
}
