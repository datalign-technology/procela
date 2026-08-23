# ECS service autoscaling (Application Auto Scaling → the backend service's
# DesiredCount). Opt-in via var.enable_autoscaling.
#
# Target tracking: AWS holds a metric near a target by adding/removing tasks and
# manages the underlying CloudWatch alarms itself. Two tracks (the scaler acts
# on whichever demands more tasks):
#   - ECS average CPU utilization (always, when autoscaling is on)
#   - ALB request-count-per-target (optional; better for I/O-bound web load)
#
# The service sets lifecycle { ignore_changes = [desired_count] } (see ecs.tf),
# so the autoscaler owns the task count without Terraform reverting it. Scale-in
# uses a longer cooldown than scale-out to avoid flapping.

resource "aws_appautoscaling_target" "ecs" {
  count              = var.enable_autoscaling ? 1 : 0
  min_capacity       = var.autoscaling_min_tasks
  max_capacity       = var.autoscaling_max_tasks
  resource_id        = "service/${aws_ecs_cluster.app.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${local.name_prefix}-cpu-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}

resource "aws_appautoscaling_policy" "requests" {
  count              = var.enable_autoscaling && var.autoscaling_enable_request_scaling ? 1 : 0
  name               = "${local.name_prefix}-requests-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      # "<alb-arn-suffix>/<target-group-arn-suffix>" — the label
      # ALBRequestCountPerTarget requires to tie the metric to this LB + TG.
      resource_label = "${aws_lb.app.arn_suffix}/${aws_lb_target_group.app.arn_suffix}"
    }
    target_value       = var.autoscaling_request_target
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
