variable "project_id" {
  description = "GCP project created by infra/terraform/bootstrap."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry and the database bucket."
  type        = string
  default     = "europe-north1"
}

variable "scheduler_region" {
  description = "Region for the Cloud Scheduler jobs that trigger the backup. Cloud Scheduler is not available in every region (not europe-north1); the job itself still runs in var.region."
  type        = string
  default     = "europe-west1"
}

variable "service_name" {
  description = "Cloud Run service name (also referenced by apps/web/firebase.json)."
  type        = string
  default     = "analytics"
}

variable "domain" {
  description = "Custom domain for dashboard + tracking via Firebase Hosting, e.g. analytics.example.com. Empty = only <site>.web.app."
  type        = string
  default     = ""
}

variable "extra_domains" {
  description = "Additional custom domains served by the same Firebase Hosting site, e.g. a short host for the tracking script (t.example.com). They serve the same content; there is no redirect, because a redirect breaks POST /api/event. Sign-in only works on `domain`."
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.extra_domains, var.domain)
    error_message = "extra_domains must not contain domain."
  }
  validation {
    condition     = length(var.extra_domains) == 0 || var.domain != ""
    error_message = "extra_domains needs domain to be set; they are aliases of it."
  }
}

variable "github_client_id" {
  description = "GitHub OAuth App client id (not secret). The client secret goes in Secret Manager, see docs/guides/deploy-gcp.md."
  type        = string
  default     = ""
}

variable "allowed_github_users" {
  description = "GitHub usernames allowed to sign in."
  type        = list(string)
  default     = []
}

variable "retention_days" {
  description = "Delete events older than this many days (0 = keep forever)."
  type        = number
  default     = 0
  validation {
    condition     = var.retention_days >= 0 && floor(var.retention_days) == var.retention_days
    error_message = "retention_days must be a whole number of days, 0 or more."
  }
}

variable "proxy_hops" {
  description = "Trusted proxies in front of the server. Firebase Hosting -> Cloud Run is expected to be 2; verify after deploy (docs/reference/configuration.md)."
  type        = number
  default     = 2
  validation {
    condition     = var.proxy_hops >= 0 && var.proxy_hops <= 5
    error_message = "proxy_hops must be between 0 and 5."
  }
}

variable "ingest_rate_limit" {
  description = "Max accepted events per second across all clients (INGEST_RATE_LIMIT). The excess gets 503 and the tracker drops it."
  type        = number
  default     = 50
  validation {
    condition     = var.ingest_rate_limit >= 1
    error_message = "ingest_rate_limit must be at least 1 (there is no unlimited mode on Cloud Run)."
  }
}

variable "max_database_mb" {
  description = "Pause ingestion while the database is larger than this (MAX_DATABASE_MB). On Cloud Run the disk lives in the instance's 512Mi of memory together with the WAL, Litestream's staging files and the Go heap, so 200 is already generous; raise the service's memory before raising this."
  type        = number
  default     = 200
  validation {
    condition     = var.max_database_mb >= 1 && var.max_database_mb <= 350
    error_message = "max_database_mb must be between 1 and 350 (the instance has 512Mi in total)."
  }
}

variable "replica_path" {
  description = "Path of the Litestream replica inside the <project_id>-db bucket. Change it only to restore from a backup file (see the runbook): a new path starts from the file you seeded there, instead of the old replica."
  type        = string
  default     = "analytics"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]*$", var.replica_path))
    error_message = "replica_path must be a single path segment: lowercase letters, digits, '.', '_' or '-'."
  }
}

variable "require_replica" {
  description = "Refuse to start with an empty Litestream replica, and treat an empty replica as a failed backup. Leave false for the very first deploy (the replica is empty by design); set true once the service has data, so a lost replica is an alert instead of a quiet fresh start."
  type        = bool
  default     = false
}

variable "log_level" {
  description = "Lowest server log level (LOG_LEVEL): debug, info, warn or error. debug also logs every rejected event (rate limits, bots); turn it on while debugging, then back off."
  type        = string
  default     = "info"
  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be debug, info, warn or error."
  }
}

variable "alert_email" {
  description = "Email address for alerts: memory pressure, load shedding, failed or missing backups, replication errors, server errors and (with domain) downtime. Empty disables alerting."
  type        = string
  default     = ""
  validation {
    condition     = var.alert_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address or empty."
  }
}

variable "backup_hourly_retention_days" {
  description = "Days to keep the hourly database backups in the backup bucket."
  type        = number
  default     = 3
  validation {
    condition     = var.backup_hourly_retention_days >= 1
    error_message = "backup_hourly_retention_days must be at least 1."
  }
}

variable "backup_daily_retention_days" {
  description = "Days to keep the daily database backups in the backup bucket."
  type        = number
  default     = 90
  validation {
    condition     = var.backup_daily_retention_days >= 1
    error_message = "backup_daily_retention_days must be at least 1."
  }
}
