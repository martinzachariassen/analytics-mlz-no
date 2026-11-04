variable "project_id" {
  description = "Globally unique GCP project id to create."
  type        = string
}

variable "project_name" {
  description = "Display name of the project."
  type        = string
  default     = "Analytics"
}

variable "billing_account" {
  description = "Billing account id, e.g. 012345-6789AB-CDEF01 (gcloud billing accounts list)."
  type        = string
}

variable "region" {
  description = "Region for the state bucket."
  type        = string
  default     = "europe-north1"
}

variable "monthly_budget" {
  description = "Monthly budget that triggers email alerts at 50%, 90% and 100% (forecast)."
  type        = number
  default     = 5
}

variable "budget_currency" {
  description = "Currency of the billing account (alerts fail if it doesn't match)."
  type        = string
  default     = "USD"
}
