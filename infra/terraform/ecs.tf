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
      AWS_S3_BUCKET_NAME      = local.media_bucket
      STORAGE_PUBLIC_BASE_URL = local.media_public_base_url
      UPSTASH_REDIS_URL       = local.redis_url
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

  autoscale_worker = var.worker_max_count > var.worker_min_count

  # Recorder launch (worker barrier and the API "Record" button): ECS RunTask on
  # the qacc-<env>-recorder task definition below.
  recorder_launch_env = {
    CLOUD_PROVIDER           = "AWS"
    AWS_ECS_CLUSTER          = aws_ecs_cluster.main.name
    AWS_ECS_TASK_DEF         = "qacc-${var.env}-recorder" # family name; avoids a cycle
    AWS_ECS_CONTAINER        = "qacc-recorder"
    AWS_ECS_SUBNETS          = join(",", local.private_subnet_ids)
    AWS_ECS_SECURITY_GROUPS  = aws_security_group.tasks.id
    AWS_ECS_ASSIGN_PUBLIC_IP = "DISABLED"
  }

  api_env = merge(local.app_env, local.recorder_launch_env, {
    PORT              = "3001"
    FRONTEND_URL      = var.public_web_url
    AUTH_GATE_ENABLED = "true"
    SSO_TED_ENABLED   = "true"
    }, local.autoscale_worker ? {
    # Feeds the worker autoscaling policy (autoscaling.tf).
    RUN_METRICS_NAMESPACE = "QACC"
    RUN_METRICS_ENV       = var.env
  } : {})

  worker_env = merge(local.app_env, local.recorder_launch_env, {
    PORT                    = "8080"
    VIDEO_RECORDING_ENABLED = tostring(var.recording_enabled)
    # Runs allowed at once = the most worker tasks autoscaling may start.
    RUN_SLOT_LIMIT = tostring(var.worker_max_count)
    # Busy workers ask ECS not to stop them (scale-in and deploys). Real ECS only.
    ECS_TASK_PROTECTION = tostring(!var.use_floci)
  })

  recorder_env = merge(local.app_env, { CLOUD_PROVIDER = "AWS" })

  # App containers get every key in the app secret except PostgREST's own and
  # the DB password it is built from.
  postgrest_secret_keys = ["PGRST_DB_URI", "PGRST_JWT_SECRET"]
  app_secrets = [
    for k, ref in local.secret_ref : { name = k, valueFrom = ref }
    if !contains(concat(local.postgrest_secret_keys, ["AUTHENTICATOR_PASSWORD"]), k)
  ]

  env_list = { for svc, m in {
    api      = local.api_env
    worker   = local.worker_env
    recorder = local.recorder_env
  } : svc => [for k in sort(keys(m)) : { name = k, value = m[k] }] }

  log_config = { for svc in ["api", "worker", "web", "recorder", "dbtools"] : svc => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.svc[svc].name
      awslogs-region        = var.region
      awslogs-stream-prefix = svc
    }
  } }

  # PostgREST sidecar, localhost only (plan D4). Not essential in the recorder:
  # the task must stop when the recording container exits.
  postgrest_container = {
    for svc, pool in { api = 5, worker = 10, recorder = 2 } : svc => {
      name                 = "postgrest"
      image                = "${local.image["postgrest"]}:${var.postgrest_image_tag}"
      essential            = svc != "recorder"
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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  cpu                = var.api_cpu
  memory             = var.api_memory
  execution_role_arn = aws_iam_role.task_exec.arn
  task_role_arn      = aws_iam_role.task.arn

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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  cpu                = var.worker_cpu
  memory             = var.worker_memory
  execution_role_arn = aws_iam_role.task_exec.arn
  task_role_arn      = aws_iam_role.task.arn

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

# Video recorder: no service. Started with RunTask, one task per viewport; the
# container exits when its video is uploaded. Same image as the worker.
resource "aws_ecs_task_definition" "recorder" {
  family                   = "qacc-${var.env}-recorder"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  cpu                = var.recorder_cpu
  memory             = var.recorder_memory
  execution_role_arn = aws_iam_role.task_exec.arn
  task_role_arn      = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name        = "qacc-recorder"
      image       = "${local.image["qacc-worker"]}:${var.image_tag}"
      essential   = true
      command     = ["node", "dist/recordingWorker.js"]
      environment = local.env_list["recorder"]
      secrets = [
        { name = "SUPABASE_SERVICE_ROLE_KEY", valueFrom = local.secret_ref["SUPABASE_SERVICE_ROLE_KEY"] },
      ]
      dependsOn        = [{ containerName = "postgrest", condition = "START" }]
      logConfiguration = local.log_config["recorder"]
    },
    local.postgrest_container["recorder"],
  ])
}

# One-off database tasks on AWS (RDS is private, so nobody connects from a
# laptop): bootstrap roles/extensions, load the schema, restore a dump from S3,
# rewrite media URLs. Started by hand with infra/aws/db-task.sh; image built from
# infra/db/Dockerfile.
resource "aws_ecs_task_definition" "dbtools" {
  count                    = local.create_data
  family                   = "qacc-${var.env}-dbtools"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  cpu                = 512
  memory             = 1024
  execution_role_arn = aws_iam_role.task_exec.arn
  task_role_arn      = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "dbtools"
      image     = "${local.image["qacc-dbtools"]}:${var.image_tag}"
      essential = true
      environment = [
        { name = "PGHOST", value = aws_db_instance.main[0].address },
        { name = "PGPORT", value = tostring(aws_db_instance.main[0].port) },
        { name = "PGDATABASE", value = "qacc" },
        { name = "PGSSLMODE", value = "require" },
        { name = "MEDIA_BUCKET", value = local.media_bucket },
        { name = "MEDIA_PUBLIC_BASE_URL", value = local.media_public_base_url },
        { name = "AWS_REGION", value = var.region },
      ]
      secrets = [
        { name = "PGUSER", valueFrom = "${aws_db_instance.main[0].master_user_secret[0].secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main[0].master_user_secret[0].secret_arn}:password::" },
        { name = "AUTHENTICATOR_PASSWORD", valueFrom = local.secret_ref["AUTHENTICATOR_PASSWORD"] },
      ]
      logConfiguration = local.log_config["dbtools"]
    },
  ])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "qacc-${var.env}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  cpu                = var.web_cpu
  memory             = var.web_memory
  execution_role_arn = aws_iam_role.task_exec.arn

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
    web = { td = aws_ecs_task_definition.web.arn, tg = aws_lb_target_group.web.arn, port = 80 }
    api = { td = aws_ecs_task_definition.api.arn, tg = aws_lb_target_group.api.arn, port = 3001 }
  }
}

resource "aws_ecs_service" "svc" {
  for_each        = local.services
  name            = "qacc-${var.env}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = each.value.td
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = local.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = each.value.tg
    container_name   = each.key
    container_port   = each.value.port
  }

  health_check_grace_period_seconds = 60

  # Task defs reference only the secret's ARN; tasks must not start before it has a value.
  depends_on = [
    aws_lb_listener_rule.api,
    aws_lb_listener_rule.web,
    aws_secretsmanager_secret_version.app,
  ]
}

moved {
  from = aws_ecs_service.svc["worker"]
  to   = aws_ecs_service.worker
}

# Worker: no load balancer. Several workers share the BullMQ queue; autoscaling
# (autoscaling.tf) sets the count between worker_min_count and worker_max_count.
resource "aws_ecs_service" "worker" {
  name            = "qacc-${var.env}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_min_count
  launch_type     = "FARGATE"

  # A deploy starts the new workers before stopping old ones; busy old workers
  # are protected from being stopped until their jobs finish (ECS_TASK_PROTECTION).
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = local.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  depends_on = [aws_secretsmanager_secret_version.app]

  lifecycle {
    # Autoscaling owns the running count once the service exists.
    ignore_changes = [desired_count]
  }
}
