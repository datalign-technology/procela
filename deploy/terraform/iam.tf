# --- Task execution role ----------------------------------------------------
# ECS agent uses this role to pull the image and write logs. It also needs
# permission to read the secrets it injects into the container environment.

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name_prefix}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.jwt_private_key.arn,
      aws_secretsmanager_secret.jwt_public_key.arn,
      aws_secretsmanager_secret.jwt_secret.arn,
      aws_secretsmanager_secret.anthropic_api_key.arn,
      aws_secretsmanager_secret.db_password.arn,
      # Read access is granted for all app secrets even when a feature
      # toggle currently leaves one out of the task — harmless, and lets an
      # operator flip a toggle without a matching IAM change.
      aws_secretsmanager_secret.mfa_encryption_key.arn,
      aws_secretsmanager_secret.scim_bearer_token.arn,
      aws_secretsmanager_secret.redis_url.arn,
      aws_secretsmanager_secret.smtp_pass.arn,
      aws_secretsmanager_secret.oidc_client_secret.arn,
      aws_secretsmanager_secret.saml_idp_cert.arn,
    ]
  }

  # When the Secrets Manager entries are encrypted with a customer-managed
  # CMK, the execution role must be allowed to decrypt under it to inject the
  # secrets into the container.
  dynamic "statement" {
    for_each = var.enable_kms_cmk ? [1] : []
    content {
      sid       = "DecryptSecretsCmk"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = [aws_kms_key.secrets[0].arn]
    }
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "${local.name_prefix}-task-execution-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

# --- Task role --------------------------------------------------------------
# Runtime role assumed by application code. Intentionally minimal — the
# reference app doesn't hit AWS APIs directly beyond CloudWatch Logs (which
# the container writes to via the log driver, not the SDK). Extend as new
# integrations are added (S3 for exports, SES for email, etc.).

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task_logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.app.arn}:*"]
  }
}

resource "aws_iam_role_policy" "task_logs" {
  name   = "${local.name_prefix}-task-logs"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_logs.json
}
