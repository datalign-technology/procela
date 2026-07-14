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

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # Reference deployment — flip to true for prod HA.

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:30-mon:05:30"

  # Reference-only settings — production should:
  #   - set deletion_protection = true
  #   - set skip_final_snapshot  = false
  #   - enable performance_insights
  #   - move to a KMS CMK for storage_encrypted
  deletion_protection      = false
  skip_final_snapshot      = true
  delete_automated_backups = true

  apply_immediately = true

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}
