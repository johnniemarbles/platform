# Platform Multi-Region Infrastructure as Code (Terraform)

This directory contains the production-grade Infrastructure as Code (IaC) blueprints for the **USA** (`us-east-1`) and **Canada** (`ca-central-1`) country cells, codified strictly against **Platform Architecture Plan V3.1** and **Gate 5 Regional Rollout**.

---

## Directory Structure

```
infra/terraform/
├── modules/
│   ├── organization/     # AWS Organization, OUs, and Region-Deny SCPs
│   ├── regional_cell/     # Reusable country cell (VPC, RDS Multi-AZ, ECS, Cognito, SES, Secrets)
│   └── edge_routing/      # Wildcard CloudFront edge & DynamoDB workspace-to-region lookup
└── environments/
    ├── management/        # Run from AWS Management/Root account (Org + SCPs)
    ├── prod_us/           # Run in US Prod Account (us-east-1)
    └── prod_ca/           # Run in Canada Prod Account (ca-central-1)
```

---

## Plan V3.1 Non-Negotiables Enforced

1. **Strict Data Residency**:
   - Canadian tenant data never leaves `ca-central-1` (PIPEDA compliance).
   - US tenant data never leaves `us-east-1` (HIPAA compliance).
   - Each country account carries an immutable **Region-Deny SCP** blocking any AWS API outside that country's assigned region (exempting global IAM/STS/Route 53/CloudFront).
2. **Cognito Essentials (No Multi-Region Replication)**:
   - One user pool per region, passwordless-by-default (email OTP + passkeys).
   - Multi-region replication is explicitly omitted.
3. **Dedicated Authentication Email Isolation**:
   - Sign-in mail uses an isolated SES Configuration Set (`auth_signin`) in each region, preventing transactional/marketing mail reputation issues from blocking logins.
4. **Disaster Recovery SLA (~5 min RPO / ~4 hr RTO)**:
   - Multi-AZ RDS PostgreSQL with 14-day Point-in-Time Recovery (PITR) and KMS encryption in private DB subnets (no internet route).
5. **Cryptographic Scope-Token Cutover**:
   - Automatically generates Ed25519 asymmetric keys in Secrets Manager.
   - `platform-api` task role is granted access to the private signing key.
   - `hub-api` task role is granted access to the public verification key.
6. **Edge Directory Sanitization (Operating Decision #1)**:
   - Edge lookup table maps `workspace_name -> region` only. Zero emails, zero tenant IDs, zero hashes.

---

## Deployment Guide

### Step 1: AWS Organization & SCPs (Management Account)
Run from your AWS Management / Root account:
```bash
cd environments/management
cp terraform.tfvars.example terraform.tfvars
# Fill in your AWS Account IDs
terraform init
terraform apply
```

### Step 2: US Production Cell (`us-east-1`)
Run with credentials for the **US Prod Account**:
```bash
cd environments/prod_us
cp terraform.tfvars.example terraform.tfvars
# Update your auth domain and ECR image URLs
terraform init
terraform apply
```

### Step 3: Canada Production Cell (`ca-central-1`)
Run with credentials for the **Canada Prod Account**:
```bash
cd environments/prod_ca
cp terraform.tfvars.example terraform.tfvars
# Update your auth domain and ECR image URLs
terraform init
terraform apply
```
