# Operations dashboard in Cloud Monitoring: traffic, errors, latency, resources, backups and
# the server's warnings and errors on one page. `terraform output dashboard_url` links to it.

locals {
  run_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\""

  # Server log lines at WARNING or above (the app's own lines, not the request log).
  server_warnings_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\" AND log_id(\"run.googleapis.com/stdout\") AND severity>=WARNING"

  chart_widgets = concat([
    {
      title = "Requests per second by status"
      xyChart = {
        dataSets = [{
          targetAxis = "Y1"
          plotType   = "STACKED_BAR"
          timeSeriesQuery = {
            timeSeriesFilter = {
              filter = "${local.run_filter} AND metric.type=\"run.googleapis.com/request_count\""
              aggregation = {
                alignmentPeriod    = "300s"
                perSeriesAligner   = "ALIGN_RATE"
                crossSeriesReducer = "REDUCE_SUM"
                groupByFields      = ["metric.label.response_code_class"]
              }
            }
          }
        }]
      }
    },
    {
      title = "Latency (p50, p95)"
      xyChart = {
        dataSets = [for p in ["50", "95"] : {
          targetAxis     = "Y1"
          plotType       = "LINE"
          legendTemplate = "p${p}"
          timeSeriesQuery = {
            timeSeriesFilter = {
              filter = "${local.run_filter} AND metric.type=\"run.googleapis.com/request_latencies\""
              aggregation = {
                alignmentPeriod    = "300s"
                perSeriesAligner   = "ALIGN_PERCENTILE_${p}"
                crossSeriesReducer = "REDUCE_MAX"
              }
            }
          }
        }]
      }
    },
    {
      title = "Memory and CPU (p99)"
      xyChart = {
        dataSets = [for m in ["memory", "cpu"] : {
          targetAxis     = "Y1"
          plotType       = "LINE"
          legendTemplate = m
          timeSeriesQuery = {
            timeSeriesFilter = {
              filter = "${local.run_filter} AND metric.type=\"run.googleapis.com/container/${m}/utilizations\""
              aggregation = {
                alignmentPeriod    = "300s"
                perSeriesAligner   = "ALIGN_PERCENTILE_99"
                crossSeriesReducer = "REDUCE_MAX"
              }
            }
          }
        }]
      }
    },
    {
      title = "Instances"
      xyChart = {
        dataSets = [{
          targetAxis = "Y1"
          plotType   = "STACKED_AREA"
          timeSeriesQuery = {
            timeSeriesFilter = {
              filter = "${local.run_filter} AND metric.type=\"run.googleapis.com/container/instance_count\""
              aggregation = {
                alignmentPeriod    = "300s"
                perSeriesAligner   = "ALIGN_MAX"
                crossSeriesReducer = "REDUCE_SUM"
                groupByFields      = ["metric.label.state"]
              }
            }
          }
        }]
      }
    },
    {
      title = "Backup runs by result"
      xyChart = {
        dataSets = [{
          targetAxis = "Y1"
          plotType   = "STACKED_BAR"
          timeSeriesQuery = {
            timeSeriesFilter = {
              filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.backup.name}\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\""
              aggregation = {
                alignmentPeriod    = "3600s"
                perSeriesAligner   = "ALIGN_SUM"
                crossSeriesReducer = "REDUCE_SUM"
                groupByFields      = ["metric.label.result"]
              }
            }
          }
        }]
      }
    },
    ], length(google_monitoring_uptime_check_config.site) > 0 ? [
    {
      title = "Uptime: ${var.domain} (share of checks passing)"
      xyChart = {
        dataSets = [{
          targetAxis = "Y1"
          plotType   = "LINE"
          timeSeriesQuery = {
            timeSeriesFilter = {
              filter = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.site[0].uptime_check_id}\""
              aggregation = {
                alignmentPeriod    = "300s"
                perSeriesAligner   = "ALIGN_FRACTION_TRUE"
                crossSeriesReducer = "REDUCE_MEAN"
              }
            }
          }
        }]
      }
    },
  ] : [])

  chart_rows = ceil(length(local.chart_widgets) / 2)
}

resource "google_monitoring_dashboard" "ops" {
  dashboard_json = jsonencode({
    displayName = "Analytics"
    mosaicLayout = {
      columns = 48
      # The API drops xPos/yPos when they are 0 and adds targetAxis = "Y1"; matching that here
      # keeps `terraform plan` clean.
      tiles = concat(
        [for i, w in local.chart_widgets : merge(
          i % 2 == 0 ? {} : { xPos = 24 },
          i < 2 ? {} : { yPos = floor(i / 2) * 16 },
          { width = 24, height = 16, widget = w },
        )],
        [{
          yPos   = local.chart_rows * 16
          width  = 48
          height = 24
          widget = {
            title = "Server warnings and errors"
            logsPanel = {
              filter        = local.server_warnings_filter
              resourceNames = ["projects/${var.project_id}"]
            }
          }
        }],
      )
    }
  })

  depends_on = [google_project_service.monitoring]
}
