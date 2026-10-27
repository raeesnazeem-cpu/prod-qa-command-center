resource "aws_ecs_cluster" "main" {
  name = "qacc-${var.env}"

  setting {
    name  = "containerInsights"
    value = var.use_floci ? "disabled" : "enabled"
  }
}

locals {
  postgrest_url = "http://127.0.0.1:3000"

  # Shared by api and worker (plan §6.1).
  app_env = merge(
    {
      NODE_ENV                = "production"
      SUPABASE_URL            = local.postgrest_url
      POSTGREST_URL           = local.postgrest_url
      REALTIME_ENABLED        = "false"
      STORAGE_BACKEND         = "s3"
      AWS_REGION              = var.region
      AWS_S3_BUCKET_NAME      = var.media_bucket
      STORAGE_PUBLIC_BASE_URL = var.media_public_base_url
      UPSTASH_REDIS_URL       = var.redis_url
      TED_PREVIEW_ONLY        = tostring(var.ted_preview_only)
      AI_FIX_MODULE_ENABLED   = "false"
      SYSTEM_ORG_ID           = var.system_org_id
      SYSTEM_USER_ID          = var.system_user_id
      LOG_LEVEL               = "info"
    },
    # floci: the SDK endpoint and static credentials (no task-role credential vending).
    var.use_floci ? {
      AWS_ENDPOINT_URL      = var.floci_endpoint
      AWS_ACCESS_KEY_ID     = "test"
      AWS_SECRET_ACCESS_KEY = "test"
    } : {},
  )

  api_env = merge(local.app_env, {
    PORT              = "3001"
    FRONTEND_URL      = var.public_web_url
    AUTH_GATE_ENABLED = "true"
    SSO_TED_ENABLED   = "true"
  })

  worker_env = merge(local.app_env, {
    PORT                     = "8080"
    CLOUD_PROVIDER           = "AWS"
    VIDEO_RECORDING_ENABLED  = "false"
    AWS_ECS_CLUSTER          = aws_ecs_cluster.main.name
    AWS_ECS_TASK_DEF         = "qacc-${var.env}-recorder"
    AWS_ECS_CONTAINER        = "qacc-recorder"
    AWS_ECS_SUBNETS          = join(",", var.private_subnet_ids)
    AWS_ECS_SECURITY_GROUPS  = aws_security_group.tasks.id
    AWS_ECS_ASSIGN_PUBLIC_IP = "DISABLED"
  })

  # App containers get every key in the app secret except PostgREST's own.
  postgrest_secret_keys = ["PGRST_DB_URI", "PGRST_JWT_SECRET"]
  app_secrets = [
    for k, ref in local.secret_ref : { name = k, valueFrom = ref }
    if !contains(local.postgrest_secret_keys, k)
  ]

  env_list = { for svc, m in {
    api    = local.api_env
    worker = local.worker_env
  } : svc => [for k in sort(keys(m)) : { name = k, value = m[k] }] }

  log_config = { for svc in ["api", "worker", "web"] : svc => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.svc[svc].name
      awslogs-region        = var.region
      awslogs-stream-prefix = svc
    }
  } }

  # PostgREST sidecar, localhost only (plan D4).
  postgrest_container = {
    for svc, pool in { api = 5, worker = 10 } : svc => {
      name                 = "postgrest"
      image                = "${local.image["postgrest"]}:${var.postgrest_image_tag}"
      essential            = true
      environment = [
        { name = "PGRST_DB_SCHEMAS", value = "public" },
        { name = "PGRST_DB_ANON_ROLE", value = "anon" },
        { name = "PGRST_SERVER_HOST", value = "127.0.0.1" },
        { name = "PGRST_SERVER_PORT", value = "3000" },
        { name = "PGRST_DB_POOL", value = tostring(pool) },
      ]
      secrets = [
        for k in local.postgrest_secret_keys : { name = k, valueFrom = local.secret_ref[k] }
      ]
      logConfiguration = local.log_config[svc]
    }
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "qacc-${var.env}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.task_exec.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name             = "api"
      image            = "${local.image["qacc-api"]}:${var.image_tag}"
      essential        = true
      portMappings     = [{ containerPort = 3001, protocol = "tcp" }]
      environment      = local.env_list["api"]
      secrets          = local.app_secrets
      dependsOn        = [{ containerName = "postgrest", condition = "START" }]
      logConfiguration = local.log_config["api"]
    },
    local.postgrest_container["api"],
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "qacc-${var.env}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.task_exec.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name        = "worker"
      image       = "${local.image["qacc-worker"]}:${var.image_tag}"
      essential   = true
      environment = local.env_list["worker"]
      secrets     = local.app_secrets
      dependsOn   = [{ containerName = "postgrest", condition = "START" }]
      # Stuck-worker detection (memory "Worker health auto-restart").
      healthCheck = {
        command     = ["CMD-SHELL", "curl -fs http://127.0.0.1:8080/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = local.log_config["worker"]
    },
    local.postgrest_container["worker"],
  ])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "qacc-${var.env}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.task_exec.arn

  container_definitions = jsonencode([
    {
      name             = "web"
      image            = "${local.image["qacc-web"]}:${var.image_tag}"
      essential        = true
      portMappings     = [{ containerPort = 80, protocol = "tcp" }]
      logConfiguration = local.log_config["web"]
    },
  ])
}

locals {
  services = {
    web    = { td = aws_ecs_task_definition.web.arn, tg = aws_lb_target_group.web.arn, port = 80 }
    api    = { td = aws_ecs_task_definition.api.arn, tg = aws_lb_target_group.api.arn, port = 3001 }
    worker = { td = aws_ecs_task_definition.worker.arn, tg = null, port = null }
  }
}

resource "aws_ecs_service" "svc" {
  for_each        = local.services
  name            = "qacc-${var.env}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = each.value.td
  desired_count   = 1
  launch_type     = "FARGATE"

  # One worker at a time: the global run slot already serialises runs, and a
  # rolling deploy must not run two Playwright workers on the same queue.
  deployment_minimum_healthy_percent = each.key == "worker" ? 0 : 100
  deployment_maximum_percent         = each.key == "worker" ? 100 : 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = each.value.tg == null ? [] : [1]
    content {
      target_group_arn = each.value.tg
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  health_check_grace_period_seconds = each.value.tg == null ? null : 60

  # Task defs reference only the secret's ARN; tasks must not start before it has a value.
  depends_on = [
    aws_lb_listener_rule.api,
    aws_lb_listener_rule.web,
    aws_secretsmanager_secret_version.app,
  ]
}
