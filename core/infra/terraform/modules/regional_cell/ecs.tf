/**
 * ECS Fargate Infrastructure for Regional Services
 *
 * Runs:
 * 1. hub-api (Port 8080)
 * 2. platform-api (Port 4000)
 *
 * Guardrails:
 * - Logs strictly remain within the in-region CloudWatch log group.
 * - IAM roles adhere to least privilege: platform-api gets private key, hub-api gets public key.
 */

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Country     = var.country_code
    Environment = var.environment
  }
}

# In-Region CloudWatch Logs (Non-Negotiable: logs stay in-country)
resource "aws_cloudwatch_log_group" "cell_logs" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30

  tags = {
    Country     = var.country_code
    Environment = var.environment
  }
}

# 1. IAM Execution Role (for pulling images & logging)
resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_base" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "ecs_secrets_access" {
  name = "${local.name_prefix}-ecs-secrets-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.scope_token_private.arn,
        aws_secretsmanager_secret.scope_token_public.arn
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.ecs_secrets_access.arn
}

# 2. IAM Task Roles (Runtime Application Permissions)
resource "aws_iam_role" "platform_api_task" {
  name = "${local.name_prefix}-platform-api-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role" "hub_api_task" {
  name = "${local.name_prefix}-hub-api-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# 3. Application Load Balancer
resource "aws_lb" "alb" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = {
    Country     = var.country_code
    Environment = var.environment
  }
}

# Target Groups
resource "aws_lb_target_group" "platform_api" {
  name        = "${local.name_prefix}-tg-platform"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.cell.id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_lb_target_group" "hub_api" {
  name        = "${local.name_prefix}-tg-hub"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.cell.id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.platform_api.arn
  }
}

# 4. Task Definitions
resource "aws_ecs_task_definition" "hub_api" {
  family                   = "${local.name_prefix}-hub-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.hub_api_task.arn

  container_definitions = jsonencode([{
    name      = "hub-api"
    image     = var.hub_api_image
    essential = true

    portMappings = [{
      containerPort = 8080
      hostPort      = 8080
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "8080" },
      { name = "SCOPE_TOKEN_ALGORITHM", value = "EdDSA" },
      { name = "CELL_COUNTRY", value = var.country_code },
      { name = "CELL_REGION", value = var.aws_region }
    ]

    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.database_url.arn}:DATABASE_URL::"
      },
      {
        name      = "SCOPE_TOKEN_ED25519_PUBLIC_KEY"
        valueFrom = aws_secretsmanager_secret.scope_token_public.arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.cell_logs.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "hub-api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "platform_api" {
  family                   = "${local.name_prefix}-platform-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.platform_api_task.arn

  container_definitions = jsonencode([{
    name      = "platform-api"
    image     = var.platform_api_image
    essential = true

    portMappings = [{
      containerPort = 4000
      hostPort      = 4000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "4000" },
      { name = "IDENTITY_PROVIDER", value = "cognito" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.pool.id },
      { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.web_client.id },
      { name = "SCOPE_TOKEN_ALGORITHM", value = "EdDSA" },
      { name = "CELL_COUNTRY", value = var.country_code },
      { name = "CELL_REGION", value = var.aws_region },
      { name = "HUB_BASE_URL", value = "http://127.0.0.1:8080" }
    ]

    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.database_url.arn}:DATABASE_URL::"
      },
      {
        name      = "SCOPE_TOKEN_ED25519_PRIVATE_KEY"
        valueFrom = aws_secretsmanager_secret.scope_token_private.arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.cell_logs.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "platform-api"
      }
    }
  }])
}

# 5. Fargate Services
resource "aws_ecs_service" "hub_api" {
  name            = "${local.name_prefix}-hub-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.hub_api.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.app[*].id
    security_groups = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.hub_api.arn
    container_name   = "hub-api"
    container_port   = 8080
  }
}

resource "aws_ecs_service" "platform_api" {
  name            = "${local.name_prefix}-platform-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.platform_api.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.app[*].id
    security_groups = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.platform_api.arn
    container_name   = "platform-api"
    container_port   = 4000
  }
}
