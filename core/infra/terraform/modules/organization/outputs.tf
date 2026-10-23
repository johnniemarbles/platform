output "organization_id" {
  description = "The ID of the AWS Organization"
  value       = data.aws_organizations_organization.current.id
}

output "prod_ou_id" {
  description = "The ID of the Prod Organizational Unit"
  value       = aws_organizations_organizational_unit.prod.id
}

output "us_region_deny_policy_id" {
  description = "ID of the US Region-Deny SCP"
  value       = aws_organizations_policy.region_deny_us.id
}

output "ca_region_deny_policy_id" {
  description = "ID of the Canada Region-Deny SCP"
  value       = aws_organizations_policy.region_deny_ca.id
}
