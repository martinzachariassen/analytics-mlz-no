# Deploys from GitHub Actions (.github/workflows/deploy.yml) without a stored key: GitHub's
# OIDC token is exchanged for short-lived credentials of the deploy service account through
# Workload Identity Federation. Off while github_repository is empty.
#
# Only a job in the repository's `production` environment, running on main, can get a token.
# The environment itself only allows main (scripts/github-settings.sh), so this is enforced
# on both sides.

locals {
  deploy_enabled = var.github_repository != ""
  deploy_count   = local.deploy_enabled ? 1 : 0
}

resource "google_project_service" "deploy" {
  for_each = local.deploy_enabled ? toset(["iamcredentials.googleapis.com", "sts.googleapis.com"]) : toset([])
  service  = each.key

  disable_on_destroy = false
}

resource "google_iam_workload_identity_pool" "github" {
  count                     = local.deploy_count
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.deploy]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = local.deploy_count
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.ref"         = "assertion.ref"
    "attribute.environment" = "assertion.environment"
  }
  # Tokens from any other repository, branch or environment are rejected before IAM is asked.
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/main\" && assertion.environment == \"production\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deploy" {
  count        = local.deploy_count
  account_id   = "analytics-deploy"
  display_name = "analytics deploys from GitHub Actions"
}

# Bound to the repository attribute, not the subject: the `sub` claim's format depends on the
# repository's OIDC settings (immutable subjects add owner and repository ids), while the
# provider's attribute_condition above already pins repository, ref and environment.
resource "google_service_account_iam_member" "deploy_from_github" {
  count              = local.deploy_count
  service_account_id = google_service_account.deploy[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repository}"
}

# What `make deploy-server` and `make deploy-web` need, and nothing more: push images, roll out
# the service and the backup job (acting as their runtime accounts) and publish Hosting.
resource "google_artifact_registry_repository_iam_member" "deploy_push" {
  count      = local.deploy_count
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deploy[0].email}"
}

resource "google_cloud_run_v2_service_iam_member" "deploy_service" {
  count    = local.deploy_count
  name     = google_cloud_run_v2_service.this.name
  location = google_cloud_run_v2_service.this.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deploy[0].email}"
}

resource "google_cloud_run_v2_job_iam_member" "deploy_backup_job" {
  count    = local.deploy_count
  name     = google_cloud_run_v2_job.backup.name
  location = google_cloud_run_v2_job.backup.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deploy[0].email}"
}

resource "google_service_account_iam_member" "deploy_acts_as" {
  for_each = local.deploy_enabled ? {
    run    = google_service_account.run.name
    backup = google_service_account.backup.name
  } : {}
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy[0].email}"
}

# firebase-tools checks that the Hosting API is enabled and that the Cloud Run service behind
# the /api/** rewrite exists before it publishes.
resource "google_project_iam_member" "deploy_project" {
  for_each = local.deploy_enabled ? toset([
    "roles/firebasehosting.admin",
    "roles/run.viewer",
    "roles/serviceusage.serviceUsageConsumer",
  ]) : toset([])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.deploy[0].email}"
}
