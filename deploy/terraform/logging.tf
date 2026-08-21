# Access-log buckets — created only when enable_access_logs = true.
#
# Two locked-down S3 buckets: one for ALB access logs, one for CloudFront
# standard logs. Both block all public access. ALB logs are delivered via a
# bucket policy (the ELB service account writes objects); CloudFront standard
# logging delivers via the awslogsdelivery canonical account, which requires
# ACLs enabled on that bucket only.
#
# ALB access logs support only SSE-S3 (AES256), so both buckets use AES256 for
# consistency — they hold request metadata, not application secrets.

# --- ALB access-log bucket --------------------------------------------------

data "aws_elb_service_account" "main" {
  count = var.enable_access_logs ? 1 : 0
}

resource "aws_s3_bucket" "alb_logs" {
  count         = var.enable_access_logs ? 1 : 0
  bucket        = "${local.name_prefix}-alb-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = { Name = "${local.name_prefix}-alb-logs" }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  count                   = var.enable_access_logs ? 1 : 0
  bucket                  = aws_s3_bucket.alb_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  count  = var.enable_access_logs ? 1 : 0
  bucket = aws_s3_bucket.alb_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "alb_logs" {
  count = var.enable_access_logs ? 1 : 0

  statement {
    sid       = "AllowELBAccessLogs"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs[0].arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  count  = var.enable_access_logs ? 1 : 0
  bucket = aws_s3_bucket.alb_logs[0].id
  policy = data.aws_iam_policy_document.alb_logs[0].json
}

# --- CloudFront standard-log bucket -----------------------------------------
# CloudFront standard logging writes via the awslogsdelivery canonical account,
# so this bucket keeps ACLs enabled (BucketOwnerPreferred) and grants that
# account FULL_CONTROL. Public access stays fully blocked (the grant is to a
# specific AWS canonical user, not a public grantee).

data "aws_canonical_user_id" "current" {
  count = var.enable_access_logs ? 1 : 0
}

resource "aws_s3_bucket" "cloudfront_logs" {
  count         = var.enable_access_logs ? 1 : 0
  bucket        = "${local.name_prefix}-cf-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = { Name = "${local.name_prefix}-cf-logs" }
}

resource "aws_s3_bucket_public_access_block" "cloudfront_logs" {
  count                   = var.enable_access_logs ? 1 : 0
  bucket                  = aws_s3_bucket.cloudfront_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs" {
  count  = var.enable_access_logs ? 1 : 0
  bucket = aws_s3_bucket.cloudfront_logs[0].id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_logs" {
  count  = var.enable_access_logs ? 1 : 0
  bucket = aws_s3_bucket.cloudfront_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_acl" "cloudfront_logs" {
  count      = var.enable_access_logs ? 1 : 0
  depends_on = [aws_s3_bucket_ownership_controls.cloudfront_logs]
  bucket     = aws_s3_bucket.cloudfront_logs[0].id

  access_control_policy {
    owner {
      id = data.aws_canonical_user_id.current[0].id
    }

    # Bucket owner keeps full control.
    grant {
      grantee {
        type = "CanonicalUser"
        id   = data.aws_canonical_user_id.current[0].id
      }
      permission = "FULL_CONTROL"
    }

    # awslogsdelivery — CloudFront's standard-log delivery account.
    grant {
      grantee {
        type = "CanonicalUser"
        id   = "c4c1ede66af53448b93c283ce9448c4ba468c9432aa01d700d3878632f77d2d0"
      }
      permission = "FULL_CONTROL"
    }
  }
}
