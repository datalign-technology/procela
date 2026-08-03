resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}-backend"
  retention_in_days = var.log_retention_days
}

# Optional secrets / config injected into the task only when their feature
# toggle is on. Keeps un-populated placeholders out of the container, and
# lets an operator turn each capability on independently once the matching
# secret is set via `put-secret-value`.
locals {
  optional_secrets = concat(
    var.enable_redis ? [{ name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn }] : [],
    var.enable_smtp ? [{ name = "SMTP_PASS", valueFrom = aws_secretsmanager_secret.smtp_pass.arn }] : [],
    var.enable_oidc ? [{ name = "OIDC_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.oidc_client_secret.arn }] : [],
    var.enable_saml ? [{ name = "SAML_IDP_CERT", valueFrom = aws_secretsmanager_secret.saml_idp_cert.arn }] : [],
    var.enable_scim ? [{ name = "SCIM_BEARER_TOKEN", valueFrom = aws_secretsmanager_secret.scim_bearer_token.arn }] : [],
  )

  smtp_environment = var.enable_smtp ? [
    { name = "SMTP_HOST", value = var.smtp_host },
    { name = "SMTP_PORT", value = tostring(var.smtp_port) },
    { name = "SMTP_USER", value = var.smtp_user },
    { name = "SMTP_SECURE", value = tostring(var.smtp_secure) },
    { name = "MAIL_FROM", value = var.mail_from },
  ] : []
}

resource "aws_ecs_cluster" "app" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "app" {
  cluster_name       = aws_ecs_cluster.app.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.app_image
      essential = true

      portMappings = [
        {
          containerPort = var.app_port
          hostPort      = var.app_port
          protocol      = "tcp"
        }
      ]

      # Non-secret config. Empty defaults are safe — the app treats an
      # empty value as unset. SMTP host/port/user/from are only added when
      # enable_smtp is set (see locals.smtp_environment).
      environment = concat([
        { name = "NODE_ENV", value = var.environment == "prod" ? "production" : var.environment },
        { name = "PORT", value = tostring(var.app_port) },
        { name = "LOG_LEVEL", value = "info" },
        { name = "AUTH_PROVIDER", value = "cognito" },
        { name = "APP_URL", value = var.app_url },
        { name = "CORS_ALLOWED_ORIGINS", value = var.cors_allowed_origins },
        { name = "SUPPORT_EMAIL", value = var.support_email },
      ], local.smtp_environment)

      # Every sensitive value is injected as a secret reference — the value
      # itself never lives in the task definition or in Terraform state.
      # The MFA key is always injected (generated, PROD-REQUIRED); the rest
      # are added only when their feature toggle is on, so an un-populated
      # placeholder is never handed to the app (see locals.optional_secrets).
      secrets = concat([
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "JWT_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.jwt_private_key.arn },
        { name = "JWT_PUBLIC_KEY", valueFrom = aws_secretsmanager_secret.jwt_public_key.arn },
        { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
        { name = "MFA_ENCRYPTION_KEY", valueFrom = aws_secretsmanager_secret.mfa_encryption_key.arn },
      ], local.optional_secrets)

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "backend"
        }
      }

      healthCheck = {
        # The health route is mounted under the API prefix (/api/v1/health);
        # an unprefixed /health 404s and would keep tasks perpetually
        # unhealthy.
        command     = ["CMD-SHELL", "wget -q -O- http://localhost:${var.app_port}/api/v1/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name                               = "${local.name_prefix}-backend"
  cluster                            = aws_ecs_cluster.app.id
  task_definition                    = aws_ecs_task_definition.app.arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "backend"
    container_port   = var.app_port
  }

  # Let CI/CD drive the image tag via `aws ecs update-service
  # --force-new-deployment`. Terraform stops fighting the pipeline over it.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.https]
}
