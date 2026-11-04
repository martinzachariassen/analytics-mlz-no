# Alerts for abuse and overload. Enabled when alert_email is set.
#
# Floods are absorbed by the server's own limits (per IP, per visitor, global, database size),
# and max_instance_count = 1 caps the bill. These alerts tell you it is happening, so you can
# clean up with POST /api/sites/{id}/purge or raise the limits for real traffic.

locals {
  alerts = var.alert_email != "" ? 1 : 0
}

resource "google_project_service" "monitoring" {
  count              = local.alerts
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

resource "google_monitoring_notification_channel" "email" {
  count        = local.alerts
  display_name = "Analytics alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.monitoring]
}

# The database lives in the instance's memory; sustained growth means a flood of events.
resource "google_monitoring_alert_policy" "memory" {
  count        = local.alerts
  display_name = "Analytics: memory above 80%"
  combiner     = "OR"

  conditions {
    display_name = "Container memory utilization"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.service_name}\" AND metric.type = \"run.googleapis.com/container/memory/utilizations\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
  documentation {
    content = "The database may be growing from a flood of events. Check the dashboard for spikes, purge spam with POST /api/sites/{id}/purge, see SECURITY.md."
  }
}

# 503 is what the server returns when it sheds load (global limit, write queue, database size).
resource "google_monitoring_alert_policy" "shedding" {
  count        = local.alerts
  display_name = "Analytics: shedding load (503)"
  combiner     = "OR"

  conditions {
    display_name = "503 responses"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.service_name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code = \"503\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
  documentation {
    content = "The server is rejecting events: over INGEST_RATE_LIMIT, write queue full or database over MAX_DATABASE_MB (check the logs). Likely a flood; see SECURITY.md."
  }
}

# A backup run that failed (for example the job image is missing or the replica is unreadable).
resource "google_monitoring_alert_policy" "backup_failed" {
  count        = local.alerts
  display_name = "Analytics: backup job failed"
  combiner     = "OR"

  conditions {
    display_name = "Failed backup executions"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"${google_cloud_run_v2_job.backup.name}\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
  documentation {
    content = "The database backup job failed. Check the job's logs in Cloud Run (Jobs). The Litestream replica is unaffected, but the standalone backups are not being written."
  }
}

# Is the service reachable from the outside? The check goes through Firebase Hosting to Cloud
# Run, the same path as a visitor's browser, and fetches the tracking script. It runs every five
# minutes from several regions and alerts when at least two of them fail for ten minutes. Needs
# `domain`, because the check targets the public hostname. (The checks also keep the instance
# warm, which does not cost extra.)
resource "google_monitoring_uptime_check_config" "site" {
  count        = var.domain != "" ? local.alerts : 0
  display_name = "Analytics: ${var.domain}"
  period       = "300s"
  timeout      = "10s"

  http_check {
    path           = "/api/script.js"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.domain
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "uptime" {
  count        = var.domain != "" ? local.alerts : 0
  display_name = "Analytics: ${var.domain} is down"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failing"
    condition_threshold {
      filter          = "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${google_monitoring_uptime_check_config.site[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
  documentation {
    content = "The tracking script is not reachable on the public hostname. Check Cloud Run (service logs, revisions) and Firebase Hosting. Events sent while the service is down are lost."
  }
}
