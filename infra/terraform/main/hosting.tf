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
