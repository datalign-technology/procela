# Container registry for the backend image. The deploy pipeline
# (.github/workflows/deploy.yml) builds and pushes here, then rolls the ECS
# service onto the new tag. Point var.app_image at "<this repo URL>:<tag>".

resource "aws_ecr_repository" "backend" {
  name                 = "${local.name_prefix}-backend"
  image_tag_mutability = "IMMUTABLE" # deploys use the immutable git-sha tag

  image_scanning_configuration {
    scan_on_push = true
  }

  # AES256 (AWS-managed) — always encrypted at rest, with no dependency on a
  # CMK key policy granting ECR. A dedicated ECR CMK can be added later if a
  # compliance regime requires customer-managed keys for the registry too.
  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${local.name_prefix}-backend"
  }
}

# Keep the registry from growing without bound: retain the last 20 images,
# expire older untagged layers after a day.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last 20 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["deploy", "main", "sha", "v"]
          countType     = "imageCountMoreThan"
          countNumber   = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}
