output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.wildcard_edge.domain_name
}

output "dynamodb_table_name" {
  description = "Name of the workspace-to-region DynamoDB table"
  value       = aws_dynamodb_table.workspace_lookup.name
}
