# Inkcast render on AWS Fargate, one task per film:
#   studio (Vercel) seals the request into Blob, then ecs:RunTask (Vercel OIDC role)
#   --> render task (Dockerfile.vercel image, src/task.ts, 8 vCPU / 16 GB arm64)
#   --> Vercel Blob: job.json progress, out.mp4 (unchanged). Pay per film, nothing idle.
#
# First apply creates the ECR repository only (image_tag empty);
# ./deploy.sh then builds, pushes and applies with the tag. Runbook: README.md

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tfstate-481912007673-use1"
    key          = "inkcast/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { project = "inkcast", managed_by = "terraform" }
  }
}

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = "tfstate-481912007673-use1"
    key    = "platform/terraform.tfstate"
    region = "us-east-1"
  }
}

data "aws_caller_identity" "me" {}

variable "image_tag" {
  description = "ECR image tag to run; set by deploy.sh. Empty creates only the repository."
  type        = string
  default     = ""
}

locals {
  name        = "inkcast-render"
  deploy      = var.image_tag != ""
  vercel_team = "yash9657s-projects"
}

# BLOB_READ_WRITE_TOKEN and INKCAST_RENDER_TOKEN, copied from the Vercel
# inkcast-render project (see README "First-time setup").
data "aws_secretsmanager_secret" "render" {
  name = "inkcast/render"
}

# The platform VPC's one public subnet: tasks get a public IP and pull the image
# straight through the internet gateway instead of through the shared NAT instance.
data "aws_subnet" "public" {
  vpc_id = data.terraform_remote_state.platform.outputs.vpc_id
  filter {
    name   = "tag:Name"
    values = ["*-public-a"]
  }
}

resource "aws_ecr_repository" "render" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
}

resource "aws_ecr_lifecycle_policy" "render" {
  repository = aws_ecr_repository.render.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 5 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "render" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14
}

# ---------------------------------------------------------------- task

resource "aws_ecs_cluster" "render" {
  name = local.name
}

# Pulls the image, writes logs, reads the two secrets. The task itself calls no AWS API.
resource "aws_iam_role" "exec" {
  name = "${local.name}-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "exec" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "exec_secret" {
  role = aws_iam_role.exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = data.aws_secretsmanager_secret.render.arn
    }]
  })
}

resource "aws_security_group" "render" {
  name        = local.name
  description = "Fargate render tasks: outbound only"
  vpc_id      = data.terraform_remote_state.platform.outputs.vpc_id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "render" {
  count                    = local.deploy ? 1 : 0
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # 8 vCPU / 16 GB: 4x the Vercel container's CPU. Six capture workers, two cores
  # left for the encoders and Kokoro.
  cpu                = 8192
  memory             = 16384
  execution_role_arn = aws_iam_role.exec.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  ephemeral_storage { size_in_gib = 30 }

  container_definitions = jsonencode([{
    name      = "render"
    image     = "${aws_ecr_repository.render.repository_url}:${var.image_tag}"
    essential = true
    command   = ["node", "--import", "tsx", "src/task.ts"]
    environment = [
      { name = "INKCAST_RENDER_WORKERS", value = "6" },
    ]
    secrets = [
      for k in ["BLOB_READ_WRITE_TOKEN", "INKCAST_RENDER_TOKEN"] :
      { name = k, valueFrom = "${data.aws_secretsmanager_secret.render.arn}:${k}::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.render.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "film"
      }
    }
  }])
}

# ---------------------------------------------------------------- studio access

# Vercel Functions present a short-lived OIDC token; no AWS key is stored on Vercel.
resource "aws_iam_openid_connect_provider" "vercel" {
  url            = "https://oidc.vercel.com/${local.vercel_team}"
  client_id_list = ["https://vercel.com/${local.vercel_team}"]
}

resource "aws_iam_role" "studio" {
  name = "${local.name}-studio"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.vercel.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "oidc.vercel.com/${local.vercel_team}:aud" = "https://vercel.com/${local.vercel_team}"
          "oidc.vercel.com/${local.vercel_team}:sub" = "owner:${local.vercel_team}:project:inkcast:environment:production"
        }
      }
    }]
  })
}

# Start render tasks on this cluster, and nothing else.
resource "aws_iam_role_policy" "studio" {
  role = aws_iam_role.studio.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = "arn:aws:ecs:us-east-1:${data.aws_caller_identity.me.account_id}:task-definition/${local.name}:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.render.arn } }
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.exec.arn
      },
    ]
  })
}

# ---------------------------------------------------------------- outputs

output "ecr_repository_url" { value = aws_ecr_repository.render.repository_url }

# Set as INKCAST_RENDER_ECS on the Vercel inkcast project (production).
output "render_ecs" {
  value = local.deploy ? jsonencode({
    region         = "us-east-1"
    cluster        = aws_ecs_cluster.render.name
    taskDefinition = aws_ecs_task_definition.render[0].arn
    container      = "render"
    subnets        = [data.aws_subnet.public.id]
    securityGroups = [aws_security_group.render.id]
    roleArn        = aws_iam_role.studio.arn
  }) : ""
}
