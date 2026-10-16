#!/usr/bin/env bash
# Build the render image (arm64), push it to ECR and point the Lambda at it.
#   ./deploy.sh [terraform apply flags, e.g. -auto-approve]   # after the first `terraform apply`
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
region=us-east-1
repo="$(cd "$here" && terraform output -raw ecr_repository_url)"
tag="$(git -C "$root" rev-parse --short HEAD)$(git -C "$root" diff --quiet || echo -dirty)"

aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${repo%%/*}"
docker buildx build --platform linux/arm64 --provenance=false -f "$root/Dockerfile.vercel" -t inkcast-render:base --load "$root"
docker buildx build --platform linux/arm64 --provenance=false -f "$root/Dockerfile.lambda" -t "$repo:$tag" --push "$root"

cd "$here" && terraform apply -var "image_tag=$tag" "$@"
