# Bootstrap: creates the GCP project, links billing, enables APIs and creates the
# bucket that stores Terraform state for infra/terraform/main. Its own state starts local and
# moves into that bucket afterwards (backend.tf.example, docs/DEPLOY.md).
#
#   cd infra/terraform/bootstrap && terraform init && terraform apply

terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
  }
}

provider "google" {
  region = var.region
}

# The budgets API rejects user credentials without a quota project. The project must exist
# before it can be the quota project, so only the budget uses this aliased provider.
provider "google" {
  alias                 = "quota"
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

resource "google_project" "this" {
  project_id      = var.project_id
  name            = var.project_name
  billing_account = var.billing_account
  deletion_policy = "PREVENT"
  labels = {
    app = "analytics"
  }
}

locals {
  services = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each           = toset(local.services)
  project            = google_project.this.project_id
  service            = each.value
  disable_on_destroy = false
}

# Terraform state for infra/terraform/main.
resource "google_storage_bucket" "tfstate" {
  project                     = google_project.this.project_id
  name                        = "${var.project_id}-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      num_newer_versions = 10
    }
    action {
      type = "Delete"
    }
  }
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.this]
}

# Email the billing account admins when spend approaches the budget.
resource "google_billing_budget" "this" {
  provider        = google.quota
  billing_account = var.billing_account
  display_name    = "${var.project_id} monthly"

  budget_filter {
    projects = ["projects/${google_project.this.number}"]
  }
  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  depends_on = [google_project_service.this]
}
