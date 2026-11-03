data "google_project" "this" {}

locals {
  public_url = var.domain != "" ? "https://${var.domain}" : "https://${google_firebase_hosting_site.this.default_url}"
  image_repo = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

# ---------------------------------------------------------------- images

resource "google_artifact_registry_repository" "images" {
  repository_id = "analytics"
  location      = var.region
  format        = "DOCKER"
  description   = "analytics server images"

  # Stay inside the 0.5 GB free storage tier.
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days
    }
  }
}

# ---------------------------------------------------------------- database replica

# Litestream continuously replicates SQLite here and restores from it on cold start.
resource "google_storage_bucket" "db" {
  name                        = "${var.project_id}-db"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Litestream creates and deletes many small files; soft delete would keep (and bill) them for 7 days.
  soft_delete_policy {
    retention_duration_seconds = 0
  }
}

# ---------------------------------------------------------------- runtime identity

resource "google_service_account" "run" {
  account_id   = "analytics-run"
  display_name = "analytics Cloud Run service"
}

resource "google_storage_bucket_iam_member" "run_db" {
  bucket = google_storage_bucket.db.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.run.email}"
}

# ---------------------------------------------------------------- secrets

resource "google_secret_manager_secret" "github_client_secret" {
  secret_id = "github-client-secret"
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

# Placeholder so Cloud Run can start before the real secret is added. Add the real value with
#   gcloud secrets versions add github-client-secret --data-file=- --project <id>
# The service reads "latest", so the real version takes over on the next deploy/cold start.
resource "google_secret_manager_secret_version" "github_client_secret_placeholder" {
  secret      = google_secret_manager_secret.github_client_secret.id
  secret_data = "replace-me"
  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

resource "google_secret_manager_secret_iam_member" "run_github" {
  secret_id = google_secret_manager_secret.github_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}
