variable "region" {
  type        = string
  description = "AWS region for all regional resources (VPC, RDS, ECS, ALB, S3)."
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Short name used to prefix every resource. Lowercase, hyphens allowed."
  default     = "procela"
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod). Included in resource names and tags."
  default     = "dev"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC. /16 recommended so subnets have room to grow."
  default     = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Exactly two /24 CIDRs for the public subnets (one per AZ)."
  default     = ["10.40.0.0/24", "10.40.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Exactly two /24 CIDRs for the private subnets (one per AZ)."
  default     = ["10.40.10.0/24", "10.40.11.0/24"]
}

variable "app_image" {
  type        = string
  description = "Fully-qualified container image reference for the backend, e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/procela-backend:latest."
}

variable "app_port" {
  type        = number
  description = "Port the backend container listens on inside the task. Matches packages/backend/Dockerfile EXPOSE."
  default     = 3001
}

variable "desired_count" {
  type        = number
  description = "Number of ECS Fargate tasks to run for the backend service."
  default     = 1
}

variable "task_cpu" {
  type        = number
  description = "Fargate task CPU units. 512 = 0.5 vCPU. See AWS docs for valid CPU/memory pairs."
  default     = 512
}

variable "task_memory" {
  type        = number
  description = "Fargate task memory in MiB. Must be compatible with task_cpu."
  default     = 1024
}

variable "alb_certificate_arn" {
  type        = string
  description = "ACM certificate ARN in var.region for the ALB HTTPS listener. Must cover the hostname the ALB is reached at (e.g. api.procela.example.com)."
}

variable "domain_name" {
  type        = string
  description = "Public hostname the CloudFront distribution serves (e.g. procela.example.com). Used as a CloudFront alias; DNS is created outside this module."
}

variable "cloudfront_certificate_arn" {
  type        = string
  description = "ACM certificate ARN in us-east-1 for the CloudFront distribution. Must cover var.domain_name. If null, CloudFront uses its default *.cloudfront.net cert (no custom domain)."
  default     = null
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class for the Postgres database."
  default     = "db.t3.small"
}

variable "db_allocated_storage_gb" {
  type        = number
  description = "Initial storage in GB for the RDS instance. gp3 storage; grows as needed if autoscaling is enabled."
  default     = 20
}

variable "db_backup_retention_days" {
  type        = number
  description = "Automated backup retention period, in days. 7 is the reference default; production typically wants 14-35."
  default     = 7
}

variable "db_name" {
  type        = string
  description = "Initial database name inside the Postgres instance."
  default     = "procela"
}

variable "db_username" {
  type        = string
  description = "Master DB username. Password is auto-generated and stored in Secrets Manager."
  default     = "procela"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log group retention for the backend container logs."
  default     = 30
}

# ── Optional-feature toggles ────────────────────────────────────────────────
# Each injects the matching secret (and, for SMTP, its non-secret config)
# into the ECS task. Populate the corresponding Secrets Manager entry with
# `put-secret-value` BEFORE flipping the toggle, or the app receives the
# REPLACE_ME placeholder and the feature degrades (mail → audit-log, etc).

variable "enable_redis" {
  type        = bool
  description = "Inject REDIS_URL for the shared rate limiter. Populate the redis_url secret first."
  default     = false
}

variable "enable_smtp" {
  type        = bool
  description = "Inject SMTP_PASS + the SMTP host/port/user/secure/from config for transactional email."
  default     = false
}

variable "enable_oidc" {
  type        = bool
  description = "Inject OIDC_CLIENT_SECRET (used when AUTH_PROVIDER=oidc)."
  default     = false
}

variable "enable_saml" {
  type        = bool
  description = "Inject SAML_IDP_CERT (used when AUTH_PROVIDER=saml)."
  default     = false
}

variable "enable_scim" {
  type        = bool
  description = "Inject SCIM_BEARER_TOKEN to activate the /scim/v2 provisioning endpoints."
  default     = false
}

# ── Non-secret application config (plain env) ───────────────────────────────
# Empty defaults are safe — the app treats an empty value as unset.

variable "auth_provider" {
  type        = string
  description = <<-EOT
    Active authentication provider (AUTH_PROVIDER). Must be one of oidc | saml |
    local. Amazon Cognito is NOT a provider value — Cognito federates via OIDC,
    so use auth_provider = "oidc" with the oidc_* config and enable_oidc = true.
    "dev" and any unrecognized value are intentionally rejected: the backend
    treats an unrecognized AUTH_PROVIDER as the insecure dev provider (any email,
    no password) and refuses to boot in production, so Terraform blocks it here.
  EOT
  default     = "oidc"

  validation {
    condition     = contains(["oidc", "saml", "local"], var.auth_provider)
    error_message = "auth_provider must be oidc, saml, or local (Cognito uses oidc; dev is not allowed in production)."
  }
}

# OIDC non-secret config — injected only when enable_oidc = true. The secret
# half (OIDC_CLIENT_SECRET) rides in via the oidc_client_secret Secrets Manager
# entry; these are the plain values that pair with it.
variable "oidc_issuer" {
  type        = string
  description = "OIDC issuer URL (OIDC_ISSUER). For Cognito: https://cognito-idp.<region>.amazonaws.com/<user-pool-id>."
  default     = ""
}

variable "oidc_client_id" {
  type        = string
  description = "OIDC client / application id (OIDC_CLIENT_ID)."
  default     = ""
}

# SAML non-secret config — injected only when enable_saml = true. The IdP
# signing certificate (SAML_IDP_CERT) rides in as a secret.
variable "saml_entry_point" {
  type        = string
  description = "IdP SSO URL where AuthnRequests are sent (SAML_ENTRY_POINT)."
  default     = ""
}

variable "saml_issuer" {
  type        = string
  description = "SP entity id — Procela's identifier to the IdP (SAML_ISSUER)."
  default     = ""
}

variable "saml_callback_url" {
  type        = string
  description = "ACS URL the IdP POSTs assertions to (SAML_CALLBACK_URL), e.g. https://<app>/api/v1/auth/saml/callback."
  default     = ""
}

variable "app_url" {
  type        = string
  description = "Public app URL, used in password-reset / support email links (APP_URL)."
  default     = ""
}

variable "cors_allowed_origins" {
  type        = string
  description = "Comma-separated extra browser origins permitted to call the API (CORS_ALLOWED_ORIGINS)."
  default     = ""
}

variable "support_email" {
  type        = string
  description = "Inbox for in-app 'Report a problem' submissions (SUPPORT_EMAIL). Defaults to Procela's support inbox; override to route to a customer-managed inbox. Needs SMTP to actually email, else audit-log only."
  default     = "support@procela.ai"
}

variable "smtp_host" {
  type        = string
  description = "SMTP server host (SMTP_HOST). Required when enable_smtp = true."
  default     = ""
}

variable "smtp_port" {
  type        = number
  description = "SMTP server port (SMTP_PORT)."
  default     = 587
}

variable "smtp_user" {
  type        = string
  description = "SMTP username (SMTP_USER)."
  default     = ""
}

variable "smtp_secure" {
  type        = bool
  description = "Use implicit TLS for SMTP (SMTP_SECURE) — true for port 465."
  default     = false
}

variable "mail_from" {
  type        = string
  description = "From header for outbound mail (MAIL_FROM)."
  default     = "Procela <noreply@procela.io>"
}

# ── Production-hardening toggles ─────────────────────────────────────────────
# Everything below defaults to false/empty so the REFERENCE deployment is
# unchanged: with no toggle flipped, `terraform plan` produces exactly the
# resources it did before this block existed. Each toggle only ADDS or
# reconfigures infrastructure — none of it changes application behaviour.
# These map 1:1 to the ⚙ items in docs/AWS_PRODUCTION_GUIDE.md §5. Flip them
# on individually (or all at once for a full hardened stack), then ALWAYS
# `terraform plan` and review before applying to a live environment — several
# of these force resource replacement (KMS re-encrypt, NAT restructure).

# 5.1 Data durability ────────────────────────────────────────────────────────

variable "rds_multi_az" {
  type        = bool
  description = "Run RDS as Multi-AZ: a synchronous standby in the second AZ fails over automatically. Roughly doubles DB cost."
  default     = false
}

variable "rds_deletion_protection" {
  type        = bool
  description = <<-EOT
    Protect the database from destruction. When true: deletion_protection is on
    (a `terraform destroy` / console delete is blocked until you turn it off),
    a final snapshot is taken on delete (skip_final_snapshot = false), and
    automated backups are retained. Leave false for throwaway/reference stacks.
  EOT
  default     = false
}

variable "rds_performance_insights" {
  type        = bool
  description = "Enable RDS Performance Insights for query-level diagnostics. Uses the RDS KMS CMK when enable_kms_cmk is also true, otherwise the AWS-managed key."
  default     = false
}

variable "rds_performance_insights_retention_days" {
  type        = number
  description = "Performance Insights retention. 7 (free tier) or a multiple of 31 up to 731. Only used when rds_performance_insights = true."
  default     = 7
}

# 5.2 Encryption — customer-managed KMS keys ─────────────────────────────────

variable "enable_kms_cmk" {
  type        = bool
  description = <<-EOT
    Create customer-managed KMS keys (with annual rotation) and point RDS
    storage, Secrets Manager entries, the CloudWatch log group, and the
    frontend S3 bucket at them instead of AWS-owned keys. Enabling this on an
    EXISTING stack re-encrypts those resources (RDS storage change, secret
    re-wrap) — review the plan carefully.
  EOT
  default     = false
}

variable "kms_deletion_window_days" {
  type        = number
  description = "Waiting period (days) before a scheduled KMS key deletion completes. 7–30."
  default     = 30
}

# 5.3 Network isolation ──────────────────────────────────────────────────────

variable "enable_vpc_endpoints" {
  type        = bool
  description = "Create VPC endpoints (S3 gateway + ECR/Secrets Manager/CloudWatch Logs interface) so tasks reach those services privately instead of over the NAT gateway."
  default     = false
}

variable "enable_nat_per_az" {
  type        = bool
  description = "Deploy one NAT gateway per AZ (with its own EIP and private route table) so a single-AZ outage does not sever egress for the healthy AZ. Off = one shared NAT (cheaper). Toggling on an existing stack re-indexes the NAT/EIP/route-table resources."
  default     = false
}

variable "restrict_alb_to_cloudfront" {
  type        = bool
  description = "Restrict the ALB security group's 80/443 ingress to AWS's managed CloudFront origin-facing prefix list instead of 0.0.0.0/0, so the ALB is only reachable through CloudFront."
  default     = false
}

variable "alb_drop_invalid_header_fields" {
  type        = bool
  description = "Have the ALB drop HTTP headers with invalid fields before forwarding to the backend (recommended for production)."
  default     = false
}

# 5.4 Edge protection — WAF ──────────────────────────────────────────────────

variable "enable_waf" {
  type        = bool
  description = "Create a WAFv2 web ACL (CLOUDFRONT scope, us-east-1) with AWS managed rule groups + a rate limit, and attach it to the CloudFront distribution."
  default     = false
}

variable "waf_rate_limit" {
  type        = number
  description = "WAF rate-based rule threshold: max requests per 5-minute window per source IP before blocking. Only used when enable_waf = true."
  default     = 2000
}

# 5.5 Secret rotation ────────────────────────────────────────────────────────

variable "enable_db_secret_rotation" {
  type        = bool
  description = "Enable automatic rotation of the RDS master-password secret. Requires db_rotation_lambda_arn to point at a Secrets-Manager rotation function (e.g. the AWS SAR SecretsManagerRDSPostgreSQLRotationSingleUser Lambda). See deploy/terraform/README.md."
  default     = false
}

variable "db_rotation_lambda_arn" {
  type        = string
  description = "ARN of the Lambda that rotates the DB password secret. Required when enable_db_secret_rotation = true; left empty otherwise."
  default     = ""
}

variable "db_rotation_days" {
  type        = number
  description = "How often (days) to rotate the DB password secret when rotation is enabled."
  default     = 30
}

# 5.6 Observability — access logs & alarms ───────────────────────────────────

variable "enable_access_logs" {
  type        = bool
  description = "Create locked-down S3 buckets and enable access logging on the ALB and the CloudFront distribution."
  default     = false
}

variable "enable_monitoring_alarms" {
  type        = bool
  description = "Create an SNS topic and CloudWatch alarms for the essentials (ALB 5xx + unhealthy hosts, ECS CPU/memory, RDS CPU/storage/connections)."
  default     = false
}

variable "alarm_email" {
  type        = string
  description = "Optional email address subscribed to the alarm SNS topic. Leave empty to wire subscriptions manually. Only used when enable_monitoring_alarms = true."
  default     = ""
}

# 5.7 Threat detection & audit trail ─────────────────────────────────────────

variable "enable_cloudtrail" {
  type        = bool
  description = "Create a multi-region CloudTrail (with log-file validation) and its locked-down S3 bucket, recording every AWS API call in this account."
  default     = false
}

variable "enable_guardduty" {
  type        = bool
  description = "Enable Amazon GuardDuty threat detection in this account/region."
  default     = false
}

variable "enable_security_hub" {
  type        = bool
  description = "Enable AWS Security Hub in this account/region (aggregates GuardDuty/Config/etc. findings)."
  default     = false
}

variable "enable_config" {
  type        = bool
  description = "Enable AWS Config: a configuration recorder + delivery channel (with its own S3 bucket and IAM role) tracking resource configuration and drift."
  default     = false
}
