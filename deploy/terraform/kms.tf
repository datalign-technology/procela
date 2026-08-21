# Customer-managed KMS keys (CMKs) — created only when enable_kms_cmk = true.
#
# Four keys, one per data domain, each with automatic annual rotation:
#   • rds      → RDS storage encryption (and Performance Insights, if on)
#   • secrets  → every Secrets Manager entry this module creates
#   • logs     → the backend CloudWatch log group
#   • s3       → the frontend S3 bucket (read by CloudFront via OAC)
#
# Splitting by domain keeps blast radius small and lets you grant/rotate each
# independently. RDS, Secrets, and S3 use the AWS default key policy (root of
# this account has full control); the logs and s3 keys additionally grant the
# CloudWatch Logs service and the CloudFront service the minimum they need.

locals {
  kms_count = var.enable_kms_cmk ? 1 : 0

  # Convenience: the key ARN or null, so callers can write
  # `local.kms_rds_arn` without repeating the count/one() dance.
  kms_rds_arn     = var.enable_kms_cmk ? aws_kms_key.rds[0].arn : null
  kms_secrets_arn = var.enable_kms_cmk ? aws_kms_key.secrets[0].arn : null
  kms_logs_arn    = var.enable_kms_cmk ? aws_kms_key.logs[0].arn : null
  kms_s3_arn      = var.enable_kms_cmk ? aws_kms_key.s3[0].arn : null
}

# --- RDS key ----------------------------------------------------------------

resource "aws_kms_key" "rds" {
  count                   = local.kms_count
  description             = "${local.name_prefix} RDS storage encryption"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true

  tags = { Name = "${local.name_prefix}-rds-kms" }
}

resource "aws_kms_alias" "rds" {
  count         = local.kms_count
  name          = "alias/${local.name_prefix}-rds"
  target_key_id = aws_kms_key.rds[0].key_id
}

# --- Secrets Manager key ----------------------------------------------------

resource "aws_kms_key" "secrets" {
  count                   = local.kms_count
  description             = "${local.name_prefix} Secrets Manager encryption"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true

  tags = { Name = "${local.name_prefix}-secrets-kms" }
}

resource "aws_kms_alias" "secrets" {
  count         = local.kms_count
  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets[0].key_id
}

# --- CloudWatch Logs key ----------------------------------------------------
# The log group can't use a CMK unless the key policy lets the regional
# CloudWatch Logs service principal encrypt/decrypt under it.

data "aws_iam_policy_document" "kms_logs" {
  count = local.kms_count

  statement {
    sid       = "AllowAccountAdmin"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowCloudWatchLogs"
    effect = "Allow"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "logs" {
  count                   = local.kms_count
  description             = "${local.name_prefix} CloudWatch Logs encryption"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_logs[0].json

  tags = { Name = "${local.name_prefix}-logs-kms" }
}

resource "aws_kms_alias" "logs" {
  count         = local.kms_count
  name          = "alias/${local.name_prefix}-logs"
  target_key_id = aws_kms_key.logs[0].key_id
}

# --- Frontend S3 key --------------------------------------------------------
# CloudFront reads the private bucket via OAC; with SSE-KMS it must be allowed
# to decrypt objects under this key, scoped to this distribution's ARN.

data "aws_iam_policy_document" "kms_s3" {
  count = local.kms_count

  statement {
    sid       = "AllowAccountAdmin"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowCloudFrontDecrypt"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_kms_key" "s3" {
  count                   = local.kms_count
  description             = "${local.name_prefix} frontend S3 bucket encryption"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_s3[0].json

  tags = { Name = "${local.name_prefix}-s3-kms" }
}

resource "aws_kms_alias" "s3" {
  count         = local.kms_count
  name          = "alias/${local.name_prefix}-s3"
  target_key_id = aws_kms_key.s3[0].key_id
}
