output "public_url" {
  description = "Dashboard URL. Use <public_url>/api/auth/github/callback in the GitHub OAuth App."
  value       = local.public_url
}

output "firebase_site" {
  value = google_firebase_hosting_site.this.site_id
}

output "firebase_default_url" {
  value = google_firebase_hosting_site.this.default_url
}

output "cloud_run_url" {
  value = google_cloud_run_v2_service.this.uri
}

output "dashboard_url" {
  description = "Operations dashboard: traffic, errors, latency, memory, backups and server warnings."
  value       = "https://console.cloud.google.com/monitoring/dashboards/builder/${element(split("/", google_monitoring_dashboard.ops.id), 3)}?project=${var.project_id}"
}

output "logs_url" {
  description = "Logs Explorer filtered to the server's warnings and errors. Remove the severity clause to see everything."
  value       = "https://console.cloud.google.com/logs/query;query=${urlencode(local.server_warnings_filter)}?project=${var.project_id}"
}

output "image_repo" {
  description = "Push server images here (make deploy or the Deploy workflow)."
  value       = local.image_repo
}

output "dns_records" {
  description = "DNS records to create for the custom domain."
  value = flatten([
    for cd in concat(
      google_firebase_hosting_custom_domain.this[*],
      values(google_firebase_hosting_custom_domain.extra),
      ) : [
      for update in cd.required_dns_updates : [
        for ds in update.desired : [
          for r in ds.records : { domain = r.domain_name, type = r.type, value = r.rdata }
        ]
      ]
    ]
  ])
}

output "github_deploy_variables" {
  description = "Repository variables for .github/workflows/deploy.yml (gh variable set NAME --body VALUE). Null while github_repository is empty."
  value = local.deploy_enabled ? {
    GCP_PROJECT_ID                 = var.project_id
    GCP_REGION                     = var.region
    GCP_WORKLOAD_IDENTITY_PROVIDER = google_iam_workload_identity_pool_provider.github[0].name
    GCP_DEPLOY_SERVICE_ACCOUNT     = google_service_account.deploy[0].email
  } : null
}
