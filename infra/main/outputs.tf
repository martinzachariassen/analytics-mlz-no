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

output "image_repo" {
  description = "Push server images here (make deploy)."
  value       = local.image_repo
}

output "dns_records" {
  description = "DNS records to create for the custom domain."
  value = var.domain == "" ? [] : flatten([
    for update in google_firebase_hosting_custom_domain.this[0].required_dns_updates : [
      for ds in update.desired : [
        for r in ds.records : { domain = r.domain_name, type = r.type, value = r.rdata }
      ]
    ]
  ])
}
