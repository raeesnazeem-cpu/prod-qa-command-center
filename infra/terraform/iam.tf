data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pull images, read the app secret, write logs.
resource "aws_iam_role" "task_exec" {
  name               = "qacc-${var.env}-task-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_exec_managed" {
  role       = aws_iam_role.task_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_exec_secrets" {
  name = "read-app-secret"
  role = aws_iam_role.task_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      # + the RDS master password AWS manages (read only by the dbtools task).
      Resource = concat(
        [aws_secretsmanager_secret.app.arn],
        var.create_data_services ? [aws_db_instance.main[0].master_user_secret[0].secret_arn] : [],
      )
    }]
  })
}

# Task role: what the app itself may do.
resource "aws_iam_role" "task" {
  name               = "qacc-${var.env}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "task" {
  name = "qacc-app"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["arn:aws:s3:::${local.media_bucket}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = ["arn:aws:s3:::${local.media_bucket}"]
      },
      {
        # Video recording: one RunTask per viewport (plan D11), from the worker
        # barrier or the API "Record" button.
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = ["arn:aws:ecs:${var.region}:*:task-definition/qacc-${var.env}-recorder*"]
      },
      {
        # Workers keep themselves alive while busy (ECS_TASK_PROTECTION).
        Effect   = "Allow"
        Action   = ["ecs:GetTaskProtection", "ecs:UpdateTaskProtection"]
        Resource = ["arn:aws:ecs:${var.region}:*:task/${aws_ecs_cluster.main.name}/*"]
      },
      {
        # The API publishes RunsInFlight for worker autoscaling.
        Effect    = "Allow"
        Action    = ["cloudwatch:PutMetricData"]
        Resource  = ["*"]
        Condition = { StringEquals = { "cloudwatch:namespace" = "QACC" } }
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.task_exec.arn, aws_iam_role.task.arn]
      },
    ]
  })
}
