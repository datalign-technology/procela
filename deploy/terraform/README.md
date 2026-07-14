# Procela — Terraform reference deployment

This module provisions the AWS surface described in `CLAUDE.md`
(section "Infrastructure — AWS Prototype") as a single, reviewable
Terraform stack. It exists so a procurement checklist can be answered
with "here is how it deploys" rather than "here is `docker compose
up`". It is **not** a hardened production deployment — see
[What this is not](#what-this-is-not) below.

## What you get

- A dedicated VPC (2 public + 2 private subnets across two AZs, one
  NAT gateway) — `network.tf`.
- RDS Postgres 16 in the private subnets, gp3 storage, 7-day backups,
  master password auto-generated and stored in Secrets Manager —
  `rds.tf`, `secrets.tf`.
- ECS Fargate cluster + service running the backend container. Task
  pulls `DATABASE_URL`, `JWT_*`, and `ANTHROPIC_API_KEY` from Secrets
  Manager as env-refs — `ecs.tf`.
- Application Load Balancer in the public subnets with an HTTPS
  listener bound to your ACM cert, HTTP redirected to HTTPS —
  `alb.tf`.
- S3 bucket (private, OAC-gated) + CloudFront distribution for the
  built React frontend. `/api/*` routes to the ALB, everything else
  to S3 with an `index.html` SPA fallback — `frontend.tf`.
- Task execution + task IAM roles, scoped to only the secrets and log
  group they need — `iam.tf`.
- CloudWatch log group for backend container logs — `ecs.tf`.

## Prereqs

- Terraform **1.6+** (tested with 1.9.x).
- AWS CLI configured with credentials that can create VPCs, ECS
  clusters, RDS instances, ALBs, CloudFront distributions, IAM
  roles, and Secrets Manager entries.
- An **ACM certificate in the same region as the deployment** for
  the ALB listener (see `alb_certificate_arn`).
- An **ACM certificate in `us-east-1`** for the CloudFront
  distribution if you want a custom domain (see
  `cloudfront_certificate_arn`). CloudFront always requires us-east-1
  certs — this is an AWS constraint, not a project choice.
- A **Route 53 hosted zone** (or equivalent DNS) for the domain you
  plan to point at CloudFront. DNS records are created outside this
  module so it stays portable.
- A container image for the backend, pushed to ECR (or any registry
  the ECS task execution role can pull from — public ECR, GHCR with
  a pull-secret, etc.). Build with
  `docker build -t procela-backend packages/backend`.

## Usage

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars      # fill in the ARNs

terraform init
terraform plan  -out plan.tfplan
terraform apply plan.tfplan
```

Apply takes ~20 minutes end to end (CloudFront is most of it).

### After apply

1. **Point DNS at CloudFront.** Take the `cloudfront_domain_name`
   output and create an ALIAS (Route 53) or CNAME (any DNS) from
   `var.domain_name` to it.
2. **Populate the placeholder secrets.** The JWT keys and the
   Anthropic API key are created as empty containers with a
   `REPLACE_ME_*` placeholder value. Fill them in:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id procela-dev/app/anthropic_api_key \
     --secret-string "sk-ant-..."
   aws secretsmanager put-secret-value \
     --secret-id procela-dev/app/jwt_private_key \
     --secret-string "$(cat jwt-private.pem)"
   aws secretsmanager put-secret-value \
     --secret-id procela-dev/app/jwt_public_key \
     --secret-string "$(cat jwt-public.pem)"
   ```
   `jwt_secret` and the DB password are auto-generated — no action
   needed. `DATABASE_URL` is composed from the RDS endpoint + the
   generated password on apply.
3. **Upload the frontend build.** Run the frontend build
   (`npm run build --workspace @procela/frontend`) and sync the
   output to the bucket named by the `frontend_bucket` output:
   ```bash
   aws s3 sync packages/frontend/dist \
     s3://$(terraform output -raw frontend_bucket)/ --delete
   aws cloudfront create-invalidation \
     --distribution-id $(terraform output -raw cloudfront_distribution_id) \
     --paths '/*'
   ```
4. **Restart the ECS service to pick up the new secret values.**
   The task caches secret values on startup, so populating the
   Anthropic / JWT secrets after the first apply requires a task
   restart:
   ```bash
   aws ecs update-service \
     --cluster  $(terraform output -raw ecs_cluster_name) \
     --service  $(terraform output -raw ecs_service_name) \
     --force-new-deployment
   ```

### Deploying a new backend image

Push the new image (retagging `:latest` or using an immutable tag),
then force a new deployment:

```bash
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw ecs_service_name) \
  --force-new-deployment
```

The task definition ignores changes to `task_definition` and
`desired_count` (`lifecycle.ignore_changes` in `ecs.tf`) so Terraform
and your CI/CD pipeline don't fight over the image tag.

## Remote state

This module intentionally uses **local state**. Real deployments must
pin state to S3 + DynamoDB. Uncomment the backend block in
`versions.tf` and adapt:

```hcl
backend "s3" {
  bucket         = "procela-tfstate-<account-id>"
  key            = "procela/dev/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "procela-tflock"
  encrypt        = true
}
```

The S3 bucket and DynamoDB lock table need to exist before
`terraform init` will succeed with a remote backend; create them with
a small bootstrap module or by hand.

## What this is not

This is a **reference deployment for review and demo purposes**. A
customer running Procela in production would extend it with at
minimum:

- **AWS WAF** in front of CloudFront, and **AWS Shield Advanced** if
  the org is a Shield subscriber.
- **A private CloudFront distribution** (signed URLs / signed cookies
  + a CloudFront Function checking auth) if the frontend is not
  intended to be publicly reachable.
- **A private ALB** if the ALB should not be reachable from the
  public internet (CloudFront -> ALB via VPC origin, or PrivateLink).
- **RDS Multi-AZ**, Performance Insights, longer backup retention,
  **`deletion_protection = true`**, and a final snapshot on
  destroy.
- **VPC endpoints** for S3, ECR, Secrets Manager, and CloudWatch Logs
  so task egress does not need to traverse the NAT (both for cost
  and for network isolation).
- **A NAT per AZ** — this module uses one NAT for cost. A single-AZ
  outage under the current layout severs egress for the other AZ.
- **KMS customer-managed keys** for RDS, Secrets Manager, S3, and
  CloudWatch Logs instead of the AWS-managed defaults.
- **GuardDuty**, **Security Hub**, **AWS Config**, and centralised
  **CloudTrail** in a security account.
- **Access logs** on the ALB and CloudFront distributed to a
  dedicated log bucket, and application logs shipped somewhere
  queryable (OpenSearch, Datadog, etc.) instead of only CloudWatch.
- **Secrets rotation** via Secrets Manager rotation Lambdas (esp.
  the DB password).
- A **CI/CD pipeline** that builds and pushes the backend image and
  syncs the frontend to S3 on merge to main.
- **Per-environment stacks** (dev / staging / prod) with separate
  state files and separate AWS accounts.

None of these are hard to bolt on — the module is deliberately kept
small so the delta from "reference" to "hardened" is auditable rather
than hidden.
