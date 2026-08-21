# CloudWatch alarms + SNS — created only when enable_monitoring_alarms = true.
#
# One SNS topic (optionally wired to alarm_email) and alarms on the essentials:
# ALB 5xx + unhealthy hosts, ECS CPU/memory, RDS CPU/storage/connections.
# Thresholds are conservative starting points — tune per workload.

locals {
  alarm_count = var.enable_monitoring_alarms ? 1 : 0
  alarm_arn   = var.enable_monitoring_alarms ? [aws_sns_topic.alarms[0].arn] : []
}

resource "aws_sns_topic" "alarms" {
  count = local.alarm_count
  name  = "${local.name_prefix}-alarms"

  tags = { Name = "${local.name_prefix}-alarms" }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.enable_monitoring_alarms && var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- ALB --------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-alb-5xx"
  alarm_description   = "Backend/ELB 5xx responses over the ALB are elevated."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.app.arn_suffix
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-alb-unhealthy-hosts"
  alarm_description   = "One or more backend targets are failing health checks."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.app.arn_suffix
    TargetGroup  = aws_lb_target_group.app.arn_suffix
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}

# --- ECS --------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-ecs-cpu"
  alarm_description   = "Backend service CPU utilization is sustained high."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.app.name
    ServiceName = aws_ecs_service.app.name
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-ecs-memory"
  alarm_description   = "Backend service memory utilization is sustained high."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.app.name
    ServiceName = aws_ecs_service.app.name
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}

# --- RDS --------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-rds-cpu"
  alarm_description   = "RDS CPU utilization is sustained high."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-rds-free-storage"
  alarm_description   = "RDS free storage is running low (< 2 GiB)."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  count               = local.alarm_count
  alarm_name          = "${local.name_prefix}-rds-connections"
  alarm_description   = "RDS connection count is unusually high."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = local.alarm_arn
  ok_actions    = local.alarm_arn
}
