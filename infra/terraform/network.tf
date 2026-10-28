# VPC with 2 public subnets (ALB, NAT) and 2 private subnets (tasks, RDS, Redis),
# one per availability zone (plan §4). Only when create_network = true.
#
# One NAT gateway, not one per AZ: it is the single biggest fixed cost (~$33/month)
# and QACC can live with a short outage if that AZ fails. Its Elastic IP is the
# fixed address scanned sites see — allowlist it where sites block datacenter IPs.

data "aws_availability_zones" "available" {
  count = var.create_network ? 1 : 0
  state = "available"
}

locals {
  azs = var.create_network ? slice(data.aws_availability_zones.available[0].names, 0, 2) : []
}

resource "aws_vpc" "main" {
  count                = var.create_network ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "qacc-${var.env}" }
}

resource "aws_internet_gateway" "main" {
  count  = var.create_network ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  tags   = { Name = "qacc-${var.env}" }
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.main[0].id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "qacc-${var.env}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main[0].id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + count.index)
  tags              = { Name = "qacc-${var.env}-private-${local.azs[count.index]}" }
}

resource "aws_eip" "nat" {
  count  = var.create_network ? 1 : 0
  domain = "vpc"
  tags   = { Name = "qacc-${var.env}-nat" }
}

resource "aws_nat_gateway" "main" {
  count         = var.create_network ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "qacc-${var.env}" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  count  = var.create_network ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }
  tags = { Name = "qacc-${var.env}-public" }
}

resource "aws_route_table" "private" {
  count  = var.create_network ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[0].id
  }
  tags = { Name = "qacc-${var.env}-private" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# Free S3 gateway endpoint: image layers (ECR stores them in S3), screenshots and
# recordings skip the NAT gateway, which charges per GB.
resource "aws_vpc_endpoint" "s3" {
  count             = var.create_network ? 1 : 0
  vpc_id            = aws_vpc.main[0].id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private[0].id]
  tags              = { Name = "qacc-${var.env}-s3" }
}

locals {
  vpc_id             = var.create_network ? aws_vpc.main[0].id : var.vpc_id
  public_subnet_ids  = var.create_network ? aws_subnet.public[*].id : var.public_subnet_ids
  private_subnet_ids = var.create_network ? aws_subnet.private[*].id : var.private_subnet_ids
}
