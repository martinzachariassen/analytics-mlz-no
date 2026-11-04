# Standalone database backups, independent of the Litestream replica.
#
# A Cloud Run Job restores the latest state from the replica bucket (it never touches the running
# service), gzips it and writes it to a separate bucket: hourly/ every hour and daily/ once a day.
# If the replica were ever damaged or deleted, these files restore with a plain `gunzip`.
# Cost: a few seconds of CPU per run, a few MB of storage, and Cloud Scheduler's free tier.

resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "backups" {
  name                        = "${var.project_id}-backups"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age            = var.backup_hourly_retention_days
      matches_prefix = ["hourly/"]
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age            = var.backup_daily_retention_days
      matches_prefix = ["daily/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_service_account" "backup" {
  account_id   = "analytics-backup"
  display_name = "analytics backup job"
}

# Reads the Litestream replica ...
resource "google_storage_bucket_iam_member" "backup_reads_db" {
  bucket = google_storage_bucket.db.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.backup.email}"
}

# ... and can only add files to the backup bucket (not overwrite or delete them).
resource "google_storage_bucket_iam_member" "backup_writes" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.backup.email}"
}

resource "google_cloud_run_v2_job" "backup" {
  name                = "${var.service_name}-backup"
  location            = var.region
  deletion_protection = true

  template {
    template {
      service_account = google_service_account.backup.email
      max_retries     = 1
      timeout         = "600s"

      containers {
        # Replaced by `make deploy`; Terraform ignores later image changes.
        image   = "us-docker.pkg.dev/cloudrun/container/hello"
        command = ["/usr/local/bin/backup.sh"]
        args    = ["hourly"]

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi" # /tmp is memory-backed: room for the restored database plus its gzip
          }
        }

        env {
          name  = "LITESTREAM_REPLICA_URL"
          value = "gs://${google_storage_bucket.db.name}/analytics"
        }
        env {
          name  = "BACKUP_BUCKET"
          value = google_storage_bucket.backups.name
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_storage_bucket_iam_member.backup_reads_db,
    google_storage_bucket_iam_member.backup_writes,
  ]
}

resource "google_service_account" "scheduler" {
  account_id   = "analytics-scheduler"
  display_name = "analytics backup scheduler"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_backup" {
  name     = google_cloud_run_v2_job.backup.name
  location = google_cloud_run_v2_job.backup.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "backup_hourly" {
  name      = "${var.service_name}-backup-hourly"
  region    = var.region
  schedule  = "17 * * * *"
  time_zone = "Etc/UTC"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.backup.name}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode(jsonencode({ overrides = { containerOverrides = [{ args = ["hourly"] }] } }))

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler, google_cloud_run_v2_job_iam_member.scheduler_runs_backup]
}

resource "google_cloud_scheduler_job" "backup_daily" {
  name      = "${var.service_name}-backup-daily"
  region    = var.region
  schedule  = "43 3 * * *"
  time_zone = "Etc/UTC"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.backup.name}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode(jsonencode({ overrides = { containerOverrides = [{ args = ["daily"] }] } }))

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler, google_cloud_run_v2_job_iam_member.scheduler_runs_backup]
}
