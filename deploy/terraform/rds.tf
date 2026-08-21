resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

resource "aws_db_instance" "postgres" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 5
  storage_type          = "gp3"
  storage_encrypted     = true
  # AWS-owned key by default; customer-managed CMK when enable_kms_cmk = true.
  kms_key_id = local.kms_rds_arn

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  # Reference deployment is single-AZ; rds_multi_az = true adds a standby.
  multi_az = var.rds_multi_az

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:30-mon:05:30"

  # Query-level diagnostics. Uses the RDS CMK when both toggles are on.
  performance_insights_enabled          = var.rds_performance_insights
  performance_insights_retention_period = var.rds_performance_insights ? var.rds_performance_insights_retention_days : null
  performance_insights_kms_key_id       = var.rds_performance_insights ? local.kms_rds_arn : null

  # Reference default deletes freely with no final snapshot. rds_deletion_protection
  # flips all three at once: block deletes, take a final snapshot, keep backups.
  deletion_protection       = var.rds_deletion_protection
  skip_final_snapshot       = !var.rds_deletion_protection
  final_snapshot_identifier = var.rds_deletion_protection ? "${local.name_prefix}-postgres-final" : null
  delete_automated_backups  = !var.rds_deletion_protection

  apply_immediately = true

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}
