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

output "secret_arns" {
  description = "ARNs of every Secrets Manager entry created by this module. Rotate values with `aws secretsmanager put-secret-value`."
  value = {
    database_url      = aws_secretsmanager_secret.database_url.arn
    jwt_private_key   = aws_secretsmanager_secret.jwt_private_key.arn
    jwt_public_key    = aws_secretsmanager_secret.jwt_public_key.arn
    jwt_secret        = aws_secretsmanager_secret.jwt_secret.arn
    anthropic_api_key = aws_secretsmanager_secret.anthropic_api_key.arn
    db_password       = aws_secretsmanager_secret.db_password.arn
    mfa_encryption_key = aws_secretsmanager_secret.mfa_encryption_key.arn
    scim_bearer_token  = aws_secretsmanager_secret.scim_bearer_token.arn
    redis_url          = aws_secretsmanager_secret.redis_url.arn
    smtp_pass          = aws_secretsmanager_secret.smtp_pass.arn
    oidc_client_secret = aws_secretsmanager_secret.oidc_client_secret.arn
    saml_idp_cert      = aws_secretsmanager_secret.saml_idp_cert.arn
  }
}
