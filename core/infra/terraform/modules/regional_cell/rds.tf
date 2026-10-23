# Dedicated KMS Key for Database Encryption in this region
resource "aws_kms_key" "rds" {
  description             = "KMS key for ${local.name_prefix} RDS PostgreSQL encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "${local.name_prefix}-rds-kms"
    Country     = var.country_code
    Environment = var.environment
  }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${local.name_prefix}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_db_subnet_group" "db" {
  name        = "${local.name_prefix}-db-subnets"
  description = "Isolated database subnets across 3 AZs for ${local.name_prefix}"
  subnet_ids  = aws_subnet.db[*].id

  tags = { Name = "${local.name_prefix}-db-subnet-group" }
}

resource "random_password" "db_master_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "postgres" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "16.3"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  db_name  = "platform"
  username = "platform_admin"
  password = random_password.db_master_password.result
  port     = 5432

  # Plan Non-Negotiable: Multi-AZ for failover & quarterly restore SLA
  multi_az               = true
  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  # Point-in-Time Recovery (PITR) configuration: ~5 min data-loss window
  backup_retention_period   = var.backup_retention_period
  backup_window             = "03:00-04:00"
  maintenance_window        = "Sun:04:30-Sun:05:30"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.environment == "prod" ? true : false
  skip_final_snapshot       = var.environment == "prod" ? false : true
  final_snapshot_identifier = "${local.name_prefix}-postgres-final-snapshot"

  auto_minor_version_upgrade = true
  allow_major_version_upgrade = false

  tags = {
    Name        = "${local.name_prefix}-postgres"
    Country     = var.country_code
    Environment = var.environment
  }
}
