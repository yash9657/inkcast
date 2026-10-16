# Inkcast render service on AWS:
#   studio (Vercel) --POST /run, bearer--> Lambda Function URL (response stream)
#   --> render-service container (Dockerfile.lambda) --> Vercel Blob (unchanged).
#
# First apply creates the ECR repository with no function (image_tag empty);
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

variable "image_tag" {
  description = "ECR image tag to run; set by deploy.sh. Empty creates only the repository."
  type        = string
  default     = ""
}

locals {
  name   = "inkcast-render"
  deploy = var.image_tag != ""
}

# BLOB_READ_WRITE_TOKEN and INKCAST_RENDER_TOKEN, copied from the Vercel
# inkcast-render project (see README "First-time setup").
data "aws_secretsmanager_secret_version" "render" {
  count     = local.deploy ? 1 : 0
  secret_id = "inkcast/render"
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

resource "aws_iam_role" "fn" {
  name = local.name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "fn_logs" {
  role       = aws_iam_role.fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "fn" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "render" {
  count         = local.deploy ? 1 : 0
  function_name = local.name
  role          = aws_iam_role.fn.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.render.repository_url}:${var.image_tag}"
  architectures = ["arm64"]
  # 10 GB is the Lambda maximum and the only way to get 6 vCPU (Vercel capped this at 2).
  memory_size = 10240
  # The studio holds /run open for up to 800 s (its after() maxDuration).
  timeout = 900
  ephemeral_storage { size = 10240 }

  environment {
    variables = jsondecode(data.aws_secretsmanager_secret_version.render[0].secret_string)
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.fn_logs]
}

# Public URL: /run checks the bearer token itself (constant-time, see server.ts).
# Response streaming because /run answers NDJSON for the whole render.
resource "aws_lambda_function_url" "render" {
  count              = local.deploy ? 1 : 0
  function_name      = aws_lambda_function.render[0].function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_cloudwatch_metric_alarm" "errors" {
  count               = local.deploy ? 1 : 0
  alarm_name          = "${local.name}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.render[0].function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.terraform_remote_state.platform.outputs.alerts_topic_arn]
  ok_actions          = [data.terraform_remote_state.platform.outputs.alerts_topic_arn]
}

output "ecr_repository_url" { value = aws_ecr_repository.render.repository_url }
output "function_url" { value = local.deploy ? aws_lambda_function_url.render[0].function_url : "" }
