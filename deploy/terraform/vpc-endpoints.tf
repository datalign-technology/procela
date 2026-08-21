# VPC endpoints — created only when enable_vpc_endpoints = true.
#
# Let Fargate tasks reach AWS services over private PrivateLink ENIs instead
# of egressing through the NAT gateway: cheaper (no per-GB NAT charge for that
# traffic) and more isolated (traffic never leaves the VPC). We cover the
# services this stack actually uses at task start-up and runtime:
#   • S3            (gateway endpoint) — ECR layer blobs live in S3
#   • ECR api + dkr (interface)        — pulling the backend image
#   • Secrets Manager (interface)      — injecting the task's secrets
#   • CloudWatch Logs (interface)      — shipping container logs

locals {
  interface_endpoint_services = var.enable_vpc_endpoints ? toset([
    "ecr.api",
    "ecr.dkr",
    "secretsmanager",
    "logs",
  ]) : toset([])
}

# SG for the interface-endpoint ENIs: allow HTTPS from inside the VPC.
resource "aws_security_group" "vpce" {
  count       = var.enable_vpc_endpoints ? 1 : 0
  name        = "${local.name_prefix}-vpce"
  description = "HTTPS from within the VPC to interface VPC endpoints."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-vpce-sg" }
}

# S3 gateway endpoint — attaches to the private route tables (all of them,
# whether one shared NAT or one per AZ).
resource "aws_vpc_endpoint" "s3" {
  count             = var.enable_vpc_endpoints ? 1 : 0
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = { Name = "${local.name_prefix}-s3-vpce" }
}

# Interface endpoints — one ENI per private subnet, private DNS on so the
# normal service hostnames resolve to the endpoint.
resource "aws_vpc_endpoint" "interface" {
  for_each            = local.interface_endpoint_services
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpce[0].id]
  private_dns_enabled = true

  tags = { Name = "${local.name_prefix}-${each.value}-vpce" }
}
