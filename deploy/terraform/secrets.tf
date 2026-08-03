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

# ─────────────────────────────────────────────────────────────────────────
# Additional application secrets — parity with the Helm chart and the
# PROD-REQUIRED secrets flagged in docs/DEPLOY_RUNBOOK.md. Two patterns:
#
#   • Values Procela can generate itself (no external dependency) are
#     generated here, so a fresh stack is secure by default — the MFA key
#     and the SCIM token. `ignore_changes` pins them so a later apply never
#     rotates them out from under existing data.
#   • Values that must match an external system (Redis, SMTP, the IdP) are
#     REPLACE_ME placeholders, set out-of-band with `put-secret-value`,
#     exactly like the JWT / API keys above.
#
# Injection into the ECS task is gated per feature in ecs.tf (except the
# MFA key, injected unconditionally) so an un-populated placeholder is
# never fed to the app.
# ─────────────────────────────────────────────────────────────────────────

# MFA_ENCRYPTION_KEY — AES-256-GCM master key for at-rest TOTP secrets.
# PROD-REQUIRED: without it the app stores TOTP secrets in plaintext.
# Generated so it is never missing.
resource "random_password" "mfa_encryption_key" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "mfa_encryption_key" {
  name                    = "${local.name_prefix}/app/mfa_encryption_key"
  description             = "AES-256-GCM master key for at-rest TOTP/MFA secret encryption (MFA_ENCRYPTION_KEY)."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "mfa_encryption_key" {
  secret_id     = aws_secretsmanager_secret.mfa_encryption_key.id
  secret_string = random_password.mfa_encryption_key.result

  lifecycle {
    # Rotating this orphans every stored TOTP secret — do it deliberately
    # via DR_RUNBOOK §3d, not on an incidental apply.
    ignore_changes = [secret_string]
  }
}

# SCIM_BEARER_TOKEN — static bearer an IdP presents to /scim/v2. Generated;
# read it out and paste into the IdP's SCIM config.
resource "random_password" "scim_bearer_token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "scim_bearer_token" {
  name                    = "${local.name_prefix}/app/scim_bearer_token"
  description             = "Static bearer token IdPs present to /scim/v2 (SCIM_BEARER_TOKEN)."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "scim_bearer_token" {
  secret_id     = aws_secretsmanager_secret.scim_bearer_token.id
  secret_string = random_password.scim_bearer_token.result

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Placeholders — populate with `put-secret-value` before enabling the
# matching feature toggle (var.enable_*) in ecs.tf.

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${local.name_prefix}/app/redis_url"
  description             = "redis:// URL for the shared rate limiter (REDIS_URL). Populate out-of-band."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "redis_url_placeholder" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "REPLACE_ME_WITH_REDIS_URL"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "smtp_pass" {
  name                    = "${local.name_prefix}/app/smtp_pass"
  description             = "SMTP password for transactional email (SMTP_PASS). Populate out-of-band."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "smtp_pass_placeholder" {
  secret_id     = aws_secretsmanager_secret.smtp_pass.id
  secret_string = "REPLACE_ME_WITH_SMTP_PASSWORD"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "oidc_client_secret" {
  name                    = "${local.name_prefix}/app/oidc_client_secret"
  description             = "OIDC client secret when AUTH_PROVIDER=oidc (OIDC_CLIENT_SECRET). Populate out-of-band."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "oidc_client_secret_placeholder" {
  secret_id     = aws_secretsmanager_secret.oidc_client_secret.id
  secret_string = "REPLACE_ME_WITH_OIDC_CLIENT_SECRET"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "saml_idp_cert" {
  name                    = "${local.name_prefix}/app/saml_idp_cert"
  description             = "IdP signing certificate (PEM) when AUTH_PROVIDER=saml (SAML_IDP_CERT). Populate out-of-band."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "saml_idp_cert_placeholder" {
  secret_id     = aws_secretsmanager_secret.saml_idp_cert.id
  secret_string = "REPLACE_ME_WITH_SAML_IDP_CERT_PEM"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
