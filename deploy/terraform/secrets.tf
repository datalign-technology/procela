# Secrets Manager entries.
#
# For the DB password we generate a value and inject it. For the JWT and
# Anthropic secrets we create empty containers — the actual values are set
# out-of-band with `aws secretsmanager put-secret-value` so no material ever
# lives in Terraform state as a plaintext default.
#
# `ignore_changes = [secret_string]` on the JWT + API-key entries lets an
# operator rotate the value without Terraform reverting it on the next apply.

resource "random_password" "db" {
  length  = 32
  special = false # RDS forbids /, @, ", and space; simplest to skip specials.
}

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${local.name_prefix}/db/password"
  description             = "Master password for the Procela RDS Postgres instance."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db.result
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name_prefix}/app/database_url"
  description             = "Full postgres:// URL the backend reads as DATABASE_URL."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s:%d/%s",
    var.db_username,
    random_password.db.result,
    aws_db_instance.postgres.address,
    aws_db_instance.postgres.port,
    var.db_name,
  )
}

resource "aws_secretsmanager_secret" "jwt_private_key" {
  name                    = "${local.name_prefix}/app/jwt_private_key"
  description             = "PEM-encoded RSA/EC private key used to sign Procela JWTs. Populate with `aws secretsmanager put-secret-value`."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt_private_key_placeholder" {
  secret_id     = aws_secretsmanager_secret.jwt_private_key.id
  secret_string = "REPLACE_ME_WITH_PEM_ENCODED_PRIVATE_KEY"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "jwt_public_key" {
  name                    = "${local.name_prefix}/app/jwt_public_key"
  description             = "PEM-encoded public key paired with jwt_private_key. Distributed to relying services / SDKs."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt_public_key_placeholder" {
  secret_id     = aws_secretsmanager_secret.jwt_public_key.id
  secret_string = "REPLACE_ME_WITH_PEM_ENCODED_PUBLIC_KEY"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${local.name_prefix}/app/jwt_secret"
  description             = "HMAC secret used for symmetric-signed tokens (session cookies, short-lived callbacks)."
  recovery_window_in_days = 7
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name                    = "${local.name_prefix}/app/anthropic_api_key"
  description             = "Anthropic Claude API key used by the backend for template generation, suggestions, and the assistant."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key_placeholder" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = "REPLACE_ME_WITH_ANTHROPIC_API_KEY"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
