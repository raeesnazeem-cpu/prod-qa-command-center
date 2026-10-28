# Worker autoscaling: one worker task per QA run in flight.
#
# The API publishes QACC/RunsInFlight (pending + running runs) every minute
# (apps/api/src/lib/runMetrics.ts). The policy keeps
#     RunsInFlight / running worker tasks  ≈ 1
# so 3 runs → 3 workers, 0 runs → worker_min_count. worker_max_count caps the
# count and is also the number of runs allowed at once (RUN_SLOT_LIMIT), so
# extra runs wait in the queue instead of starting a run with no worker.
#
# Busy workers protect themselves from scale-in (ECS_TASK_PROTECTION), so
# shrinking only stops idle tasks. The policy exists only when
# worker_max_count > worker_min_count; the target always exists, because it is
# what keeps the worker count inside min..max (the service ignores desired_count
# after creation).

resource "aws_appautoscaling_target" "worker" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.worker_min_count
  max_capacity       = var.worker_max_count
}

resource "aws_appautoscaling_policy" "worker_runs" {
  count              = local.autoscale_worker ? 1 : 0
  name               = "qacc-${var.env}-worker-runs-in-flight"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 1
    scale_out_cooldown = 60
    # Wait 10 min before removing workers: a finished run is often followed by another.
    scale_in_cooldown = 600

    customized_metric_specification {
      metrics {
        id          = "runs"
        return_data = false
        metric_stat {
          stat = "Maximum"
          metric {
            namespace   = "QACC"
            metric_name = "RunsInFlight"
            dimensions {
              name  = "Env"
              value = var.env
            }
          }
        }
      }
      metrics {
        id          = "workers"
        return_data = false
        metric_stat {
          stat = "Average"
          metric {
            namespace   = "ECS/ContainerInsights"
            metric_name = "RunningTaskCount"
            dimensions {
              name  = "ClusterName"
              value = aws_ecs_cluster.main.name
            }
            dimensions {
              name  = "ServiceName"
              value = aws_ecs_service.worker.name
            }
          }
        }
      }
      metrics {
        id          = "runs_per_worker"
        label       = "Runs in flight per running worker"
        expression  = "IF(workers > 0, runs / workers, runs)"
        return_data = true
      }
    }
  }
}

# Scale from zero (only when worker_min_count = 0). "Runs per worker" cannot be
# worked out with no worker running, so a separate alarm starts the first one
# when a run is waiting and no worker is up. The tracking policy takes over from 1.
resource "aws_cloudwatch_metric_alarm" "worker_from_zero" {
  count               = local.autoscale_worker && var.worker_min_count == 0 ? 1 : 0
  alarm_name          = "qacc-${var.env}-worker-from-zero"
  alarm_description   = "A QA run is waiting and no worker is running"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.worker_from_zero[0].arn]

  metric_query {
    id          = "runs"
    return_data = false
    metric {
      namespace   = "QACC"
      metric_name = "RunsInFlight"
      dimensions  = { Env = var.env }
      stat        = "Maximum"
      period      = 60
    }
  }
  metric_query {
    id          = "workers"
    return_data = false
    metric {
      namespace   = "ECS/ContainerInsights"
      metric_name = "RunningTaskCount"
      dimensions  = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.worker.name }
      stat        = "Average"
      period      = 60
    }
  }
  metric_query {
    id          = "need_first_worker"
    expression  = "IF(runs > 0 AND FILL(workers, 0) == 0, 1, 0)"
    label       = "Run waiting with no worker"
    return_data = true
  }
}

resource "aws_appautoscaling_policy" "worker_from_zero" {
  count              = local.autoscale_worker && var.worker_min_count == 0 ? 1 : 0
  name               = "qacc-${var.env}-worker-from-zero"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type = "ExactCapacity"
    cooldown        = 60
    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}
