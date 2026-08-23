output "alb_dns_name" {
  description = "Public DNS name of the ALB. Point CloudFront (or a direct CNAME, for API-only access) at this."
  value       = aws_lb.app.dns_name
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain. Create a Route 53 alias (or CNAME) from var.domain_name to this value."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Useful for `aws cloudfront create-invalidation` after a frontend deploy."
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_bucket" {
  description = "S3 bucket that holds the built React frontend. Sync your `dist/` output here."
  value       = aws_s3_bucket.frontend.bucket
}

output "rds_endpoint" {
  description = "RDS Postgres endpoint (host:port)."
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "ecs_cluster_name" {
  description = "ECS cluster name. Pass to `aws ecs update-service --cluster` for redeploys."
  value       = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  description = "ECS service name. Pass to `aws ecs update-service --service` for redeploys."
  value       = aws_ecs_service.app.name
}

output "log_group_name" {
  description = "CloudWatch log group receiving backend container logs."
  value       = aws_cloudwatch_log_group.app.name
}

# ── Hardening outputs ───────────────────────────────────────────────────────
# All null/empty unless the matching toggle is enabled.

output "kms_key_arns" {
  description = "Customer-managed KMS key ARNs (null unless enable_kms_cmk = true)."
  value = {
    rds     = local.kms_rds_arn
    secrets = local.kms_secrets_arn
    logs    = local.kms_logs_arn
    s3      = local.kms_s3_arn
  }
}

output "waf_web_acl_arn" {
  description = "CloudFront WAF web ACL ARN (null unless enable_waf = true)."
  value       = var.enable_waf ? aws_wafv2_web_acl.cloudfront[0].arn : null
}

output "access_log_buckets" {
  description = "ALB and CloudFront access-log bucket names (null unless enable_access_logs = true)."
  value = {
    alb        = var.enable_access_logs ? aws_s3_bucket.alb_logs[0].bucket : null
    cloudfront = var.enable_access_logs ? aws_s3_bucket.cloudfront_logs[0].bucket : null
  }
}

output "alarms_sns_topic_arn" {
  description = "SNS topic ARN alarms publish to (null unless enable_monitoring_alarms = true). Subscribe pagers/Slack here."
  value       = var.enable_monitoring_alarms ? aws_sns_topic.alarms[0].arn : null
}

output "cloudtrail_bucket" {
  description = "CloudTrail log bucket name (null unless enable_cloudtrail = true)."
  value       = var.enable_cloudtrail ? aws_s3_bucket.cloudtrail[0].bucket : null
}

output "secret_arns" {
  description = "ARNs of every Secrets Manager entry created by this module. Rotate values with `aws secretsmanager put-secret-value`."
  value = {
    database_url       = aws_secretsmanager_secret.database_url.arn
    jwt_private_key    = aws_secretsmanager_secret.jwt_private_key.arn
    jwt_public_key     = aws_secretsmanager_secret.jwt_public_key.arn
    jwt_secret         = aws_secretsmanager_secret.jwt_secret.arn
    anthropic_api_key  = aws_secretsmanager_secret.anthropic_api_key.arn
    db_password        = aws_secretsmanager_secret.db_password.arn
    mfa_encryption_key = aws_secretsmanager_secret.mfa_encryption_key.arn
    scim_bearer_token  = aws_secretsmanager_secret.scim_bearer_token.arn
    redis_url          = aws_secretsmanager_secret.redis_url.arn
    smtp_pass          = aws_secretsmanager_secret.smtp_pass.arn
    oidc_client_secret = aws_secretsmanager_secret.oidc_client_secret.arn
    saml_idp_cert      = aws_secretsmanager_secret.saml_idp_cert.arn
  }
}

# ── CI/CD deploy pipeline outputs ───────────────────────────────────────────
# Set these as GitHub Actions repository variables so .github/workflows/deploy.yml
# can find the stack (see the workflow header for the var → output mapping).

output "ecr_repository_url" {
  description = "ECR repo the deploy pipeline pushes the backend image to. Point var.app_image at <this>:<tag>."
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_task_family" {
  description = "Backend task-definition family. The pipeline registers new revisions of this and rolls the service onto them."
  value       = aws_ecs_task_definition.app.family
}

output "migrate_task_family" {
  description = "Migrate task-definition family (one-off `prisma migrate deploy` task)."
  value       = aws_ecs_task_definition.migrate.family
}

output "region" {
  description = "AWS region — pass to the deploy pipeline as AWS_REGION."
  value       = var.region
}

output "cicd_deploy_role_arn" {
  description = "ARN of the GitHub Actions OIDC deploy role (null unless enable_cicd_deploy_role = true)."
  value       = var.enable_cicd_deploy_role ? aws_iam_role.cicd_deploy[0].arn : null
}

output "private_subnet_ids" {
  description = "Comma-separated private subnet ids — the deploy pipeline's migrate run-task network config (ECS_SUBNET_IDS)."
  value       = join(",", aws_subnet.private[*].id)
}

output "ecs_security_group_id" {
  description = "ECS task security-group id — the deploy pipeline's migrate run-task network config (ECS_SECURITY_GROUP_ID)."
  value       = aws_security_group.ecs_tasks.id
}
