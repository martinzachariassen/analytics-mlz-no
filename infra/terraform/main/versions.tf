terraform {
  required_version = ">= 1.9"

  # Bucket comes from infra/terraform/bootstrap: terraform init -backend-config=bucket=<state_bucket>
  backend "gcs" {
    prefix = "main"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.9"
    }
  }
}

# Firebase APIs reject user credentials without a quota project, hence user_project_override.
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
