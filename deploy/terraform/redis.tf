# ElastiCache (Redis) for the shared rate limiter. Previously the module only
# injected a REDIS_URL secret you had to populate from a manually-created
# cluster; without it, rate limiting silently degraded to per-task in-memory
# (so brute-force protection was broken across >1 task). This provisions a
# real, network-isolated, encrypted-at-rest replication group and wires its
# endpoint into the redis_url secret automatically.
#
# All resources are gated by var.enable_redis (default true). Reachable only
# from the ECS task security group, in the private subnets — never public.

resource "aws_security_group" "redis" {
  count       = var.enable_redis ? 1 : 0
  name        = "${local.name_prefix}-redis"
  description = "Ingress to Redis from ECS tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = {
    Name = "${local.name_prefix}-redis-sg"
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  count      = var.enable_redis ? 1 : 0
  name       = "${local.name_prefix}-redis"
  subnet_ids = aws_subnet.private[*].id
}

# Auth token for in-transit AUTH, only used when transit encryption is on.
# Alphanumeric (special = false) so it drops into the redis URL without any
# percent-encoding, and stays inside ElastiCache's auth-token charset.
resource "random_password" "redis_auth" {
  count   = var.enable_redis && var.redis_transit_encryption ? 1 : 0
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "redis" {
  count                = var.enable_redis ? 1 : 0
  replication_group_id = "${local.name_prefix}-redis"
  description          = "Procela shared rate-limiter cache"

  engine         = "redis"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = 6379

  # HA: >1 node enables a replica + automatic failover across AZs.
  num_cache_clusters         = var.redis_num_nodes
  automatic_failover_enabled = var.redis_num_nodes > 1
  multi_az_enabled           = var.redis_num_nodes > 1

  subnet_group_name  = aws_elasticache_subnet_group.redis[0].name
  security_group_ids = [aws_security_group.redis[0].id]

  # Encryption at rest is always on (AWS-managed key). Transit encryption +
  # AUTH is opt-out via var.redis_transit_encryption (default on) — the app's
  # node-redis client speaks rediss:// with the token in the URL.
  at_rest_encryption_enabled = true
  transit_encryption_enabled = var.redis_transit_encryption
  auth_token                 = var.redis_transit_encryption ? random_password.redis_auth[0].result : null

  apply_immediately = true

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

# Populate the redis_url secret from the provisioned endpoint. rediss:// + the
# AUTH token when transit encryption is on; plain redis:// otherwise. The
# placeholder version in secrets.tf is skipped when enable_redis is true.
resource "aws_secretsmanager_secret_version" "redis_url_provisioned" {
  count     = var.enable_redis ? 1 : 0
  secret_id = aws_secretsmanager_secret.redis_url.id
  secret_string = var.redis_transit_encryption ? (
    "rediss://:${random_password.redis_auth[0].result}@${aws_elasticache_replication_group.redis[0].primary_endpoint_address}:6379"
    ) : (
    "redis://${aws_elasticache_replication_group.redis[0].primary_endpoint_address}:6379"
  )
}
