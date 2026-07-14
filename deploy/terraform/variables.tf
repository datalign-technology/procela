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
