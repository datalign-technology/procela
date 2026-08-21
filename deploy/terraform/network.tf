data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  # One shared NAT by default; one per AZ when enable_nat_per_az = true. The
  # EIP / NAT gateway / private route table resources are counted on this so
  # the reference deployment stays at a single NAT.
  nat_count = var.enable_nat_per_az ? length(local.azs) : 1
}

# --- VPC ---------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

# --- Internet gateway + public subnets --------------------------------------

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  count                   = length(var.public_subnet_cidrs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-${count.index}"
    Tier = "public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- Private subnets + NAT gateway(s) ---------------------------------------
# One shared NAT by default (a cost-shaping choice). With enable_nat_per_az =
# true there is one NAT per AZ, so a single-AZ outage does not sever egress
# for tasks in the healthy AZ. local.nat_count drives the fan-out.

resource "aws_subnet" "private" {
  count             = length(var.private_subnet_cidrs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.name_prefix}-private-${count.index}"
    Tier = "private"
  }
}

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat-eip-${count.index}"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "main" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "${local.name_prefix}-nat-${count.index}"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  count  = local.nat_count
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = {
    Name = "${local.name_prefix}-private-rt-${count.index}"
  }
}

# Each private subnet routes through the NAT in its own AZ when per-AZ NAT is
# on; otherwise every subnet shares the single route table (index 0).
resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[var.enable_nat_per_az ? count.index : 0].id
}

# --- Security groups --------------------------------------------------------

# AWS-managed prefix list of CloudFront's origin-facing IP ranges. Fetched
# only when we intend to lock the ALB down to CloudFront-only ingress.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  count = var.restrict_alb_to_cloudfront ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Ingress to the public ALB (HTTPS from the world, HTTP redirect)."
  vpc_id      = aws_vpc.main.id

  # By default open to the world; when restrict_alb_to_cloudfront = true the
  # source becomes CloudFront's managed prefix list so only CloudFront can
  # reach the ALB directly.
  ingress {
    description     = "HTTPS (world, or CloudFront-only when restricted)"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    cidr_blocks     = var.restrict_alb_to_cloudfront ? [] : ["0.0.0.0/0"]
    prefix_list_ids = var.restrict_alb_to_cloudfront ? [data.aws_ec2_managed_prefix_list.cloudfront[0].id] : []
  }

  ingress {
    description     = "HTTP for redirect to HTTPS (world, or CloudFront-only when restricted)"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    cidr_blocks     = var.restrict_alb_to_cloudfront ? [] : ["0.0.0.0/0"]
    prefix_list_ids = var.restrict_alb_to_cloudfront ? [data.aws_ec2_managed_prefix_list.cloudfront[0].id] : []
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-alb-sg"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name_prefix}-ecs-tasks"
  description = "Ingress to backend containers from the ALB only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App traffic from ALB"
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All egress (via NAT)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ecs-sg"
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Ingress to Postgres from ECS tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  # No egress rules needed for RDS; the default of "none" is fine.

  tags = {
    Name = "${local.name_prefix}-rds-sg"
  }
}
