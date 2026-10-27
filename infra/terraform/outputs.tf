output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecr_repositories" {
  value = local.image
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "services" {
  value = { for k, s in aws_ecs_service.svc : k => s.name }
}
