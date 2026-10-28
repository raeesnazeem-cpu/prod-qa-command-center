output "alb_dns_name" {
  description = "Point web_host and api_host here (CNAME) in your DNS"
  value       = aws_lb.main.dns_name
}

output "ecr_repositories" {
  value = local.image
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "services" {
  value = merge({ for k, s in aws_ecs_service.svc : k => s.name }, { worker = aws_ecs_service.worker.name })
}

output "private_subnet_ids" {
  value = local.private_subnet_ids
}

output "tasks_security_group_id" {
  value = aws_security_group.tasks.id
}

output "nat_public_ip" {
  description = "Fixed outbound IP of every task. Give it to sites that block datacenter IPs."
  value       = var.create_network ? aws_eip.nat[0].public_ip : null
}

output "media_bucket" {
  value = local.media_bucket
}

output "media_public_base_url" {
  value = local.media_public_base_url
}

output "db_address" {
  value = var.create_data_services ? aws_db_instance.main[0].address : null
}

output "db_master_secret_arn" {
  description = "Secrets Manager secret holding the RDS master user/password (AWS-managed)"
  value       = var.create_data_services ? aws_db_instance.main[0].master_user_secret[0].secret_arn : null
}

output "acm_validation_records" {
  description = "Add these CNAME records in your DNS so AWS can issue the HTTPS certificate"
  value = var.https_enabled ? [
    for o in aws_acm_certificate.main[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}
