# GitHub Actions deploy role (OIDC — no static AWS keys).
#
# .github/workflows/deploy.yml assumes this role over GitHub's OIDC provider to:
#   - push the backend image to ECR,
#   - register new task-def revisions + run the migrate task + roll the service,
#   - sync the frontend to S3 and invalidate CloudFront.
#
# All gated by var.enable_cicd_deploy_role. The GitHub OIDC provider is
# account-global (only one allowed), so it's created here only when
# var.github_oidc_provider_arn is empty; otherwise the existing one is reused.

locals {
  cicd_enabled  = var.enable_cicd_deploy_role
  create_oidc   = local.cicd_enabled && var.github_oidc_provider_arn == ""
  github_oidc_arn = local.cicd_enabled ? (
    var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
  ) : ""
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = local.create_oidc ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint is no longer validated by STS for this provider,
  # but the field is still required; this is GitHub's documented value.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "cicd_trust" {
  count = local.cicd_enabled ? 1 : 0
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Restrict to this repo + ref (default: the default branch). Use
    # github_deploy_ref = "*" to allow any ref (e.g. workflow_dispatch runs).
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:${var.github_deploy_ref}"]
    }
  }
}

resource "aws_iam_role" "cicd_deploy" {
  count              = local.cicd_enabled ? 1 : 0
  name               = "${local.name_prefix}-cicd-deploy"
  assume_role_policy = data.aws_iam_policy_document.cicd_trust[0].json
}

data "aws_iam_policy_document" "cicd_deploy" {
  count = local.cicd_enabled ? 1 : 0

  # ECR: auth + push to the backend repo.
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }

  # ECS: register new task-def revisions, roll the service, run the migrate task.
  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:RunTask",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
    ]
    resources = ["*"] # ECS deploy actions are largely un-resource-scopable
  }

  # Pass the task + execution roles to ECS when registering task defs / running
  # tasks. Scoped to exactly the two roles this stack owns.
  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task.arn, aws_iam_role.task_execution.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # Frontend: sync the built assets to the S3 bucket.
  statement {
    sid       = "FrontendS3"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"]
  }

  # Invalidate CloudFront after a frontend sync.
  statement {
    sid       = "CloudFrontInvalidate"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.frontend.arn]
  }
}

resource "aws_iam_role_policy" "cicd_deploy" {
  count  = local.cicd_enabled ? 1 : 0
  name   = "${local.name_prefix}-cicd-deploy"
  role   = aws_iam_role.cicd_deploy[0].id
  policy = data.aws_iam_policy_document.cicd_deploy[0].json
}
