output "project_id" {
  value = google_project.this.project_id
}

output "state_bucket" {
  description = "Pass to infra/terraform/main: terraform init -backend-config=bucket=<this>"
  value       = google_storage_bucket.tfstate.name
}
