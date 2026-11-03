variable "project_id" {
  description = "GCP project created by infra/bootstrap."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry and the database bucket."
  type        = string
  default     = "europe-north1"
}

variable "service_name" {
  description = "Cloud Run service name (also referenced by web/firebase.json)."
  type        = string
  default     = "analytics"
}

variable "domain" {
  description = "Custom domain for dashboard + tracking via Firebase Hosting, e.g. t.example.com. Empty = only <site>.web.app."
  type        = string
  default     = ""
}

variable "github_client_id" {
  description = "GitHub OAuth App client id (not secret). The client secret goes in Secret Manager, see docs/DEPLOY.md."
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
}

variable "proxy_hops" {
  description = "Trusted proxies in front of the server. Firebase Hosting -> Cloud Run is expected to be 2; verify after deploy (docs/DEPLOY.md)."
  type        = number
  default     = 2
}
