# One-off database migration task.
#
# Migrations don't run on container boot (the app CMD is just `node
# dist/index.js`), so a schema change needs `prisma migrate deploy` run against
# RDS once per deploy. This defines a standalone Fargate task — same image and
# DATABASE_URL secret as the app, but with the command overridden to run the
# migration and no port/health-check — that an operator (or a deploy pipeline)
# launches with `aws ecs run-task`. The ready-to-run command is emitted as the
# `migrate_run_task_command` output.
#
# It runs in the private subnets with the ECS task security group, so it
# reaches RDS the same way the app does — no bastion/VPN required.

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # Migrations are light; pin a small, valid Fargate cpu/memory pair.
  cpu                = "256"
  memory             = "512"
  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = var.app_image
      essential = true
      # `prisma migrate deploy` from the image's WORKDIR (/app), where prisma/
      # is copied. Applies every pending migration and exits 0; the task then
      # stops, so run-task returns the exit code.
      command = ["npx", "prisma", "migrate", "deploy"]

      # Only the DB URL is needed to migrate.
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "migrate"
        }
      }
    }
  ])
}

# Copy-paste command to run migrations. Fill nothing in — the subnet and
# security-group ids are resolved from this module's state.
output "migrate_run_task_command" {
  description = "Run pending DB migrations against RDS as a one-off Fargate task."
  value = join(" ", [
    "aws ecs run-task",
    "--region ${var.region}",
    "--cluster ${aws_ecs_cluster.app.name}",
    "--task-definition ${aws_ecs_task_definition.migrate.family}",
    "--launch-type FARGATE",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.ecs_tasks.id}],assignPublicIp=DISABLED}'",
  ])
}
