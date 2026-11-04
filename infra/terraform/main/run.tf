# Cloud Run service, option A: scale to zero, request-based billing, a single instance.
#
# SQLite allows one writer, so max_instance_count = 1. Litestream restores the database
# from GCS on cold start and replicates every second while the instance has CPU.
# Known trade-off: during a deploy the new instance restores while the old one still
# serves, so events from those few seconds can be lost. See docs/DEPLOY.md.
resource "google_cloud_run_v2_service" "this" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.run.email
    max_instance_request_concurrency = 80
    timeout                          = "30s"

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      # Replaced by `make deploy`; Terraform ignores later image changes.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true # request-based billing: no CPU (and no cost) between requests
        startup_cpu_boost = true # faster cold starts (restore + migrations)
      }

      env {
        name  = "PUBLIC_URL"
        value = local.public_url
      }
      env {
        name  = "PROXY_HOPS"
        value = tostring(var.proxy_hops)
      }
      env {
        name  = "RETENTION_DAYS"
        value = tostring(var.retention_days)
      }
      env {
        name  = "INGEST_RATE_LIMIT"
        value = tostring(var.ingest_rate_limit)
      }
      env {
        name  = "MAX_DATABASE_MB"
        value = tostring(var.max_database_mb)
      }
      env {
        name  = "LITESTREAM_REPLICA_URL"
        value = "gs://${google_storage_bucket.db.name}/analytics"
      }
      env {
        name  = "GITHUB_CLIENT_ID"
        value = var.github_client_id
      }
      env {
        name  = "ALLOWED_GITHUB_USERS"
        value = join(",", var.allowed_github_users)
      }
      env {
        name = "GITHUB_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.github_client_secret.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 0
        period_seconds        = 2
        timeout_seconds       = 2
        failure_threshold     = 30 # up to ~60s for a large restore
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret_version.github_client_secret_placeholder,
    google_secret_manager_secret_iam_member.run_github,
    google_storage_bucket_iam_member.run_db,
  ]
}

# Public: the tracker posts events from any site, and Firebase Hosting proxies the dashboard.
# Dashboard endpoints are protected by the app's own GitHub sign-in.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.this.name
  location = google_cloud_run_v2_service.this.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
