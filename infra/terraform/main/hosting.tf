# Firebase Hosting serves the dashboard (apps/web/dist) and rewrites /api/** to Cloud Run,
# so dashboard, API and tracking script share one origin (see apps/web/firebase.json).

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id
}

resource "google_firebase_hosting_site" "this" {
  provider = google-beta
  project  = google_firebase_project.this.project
  site_id  = var.project_id
}

resource "google_firebase_hosting_custom_domain" "this" {
  count    = var.domain != "" ? 1 : 0
  provider = google-beta

  project       = google_firebase_project.this.project
  site_id       = google_firebase_hosting_site.this.site_id
  custom_domain = var.domain

  # DNS is managed outside Terraform (Domeneshop); records are in the outputs.
  wait_dns_verification = false
}

# Aliases for the same site (see var.extra_domains).
resource "google_firebase_hosting_custom_domain" "extra" {
  for_each = var.domain != "" ? toset(var.extra_domains) : toset([])
  provider = google-beta

  project       = google_firebase_project.this.project
  site_id       = google_firebase_hosting_site.this.site_id
  custom_domain = each.value

  wait_dns_verification = false
}
