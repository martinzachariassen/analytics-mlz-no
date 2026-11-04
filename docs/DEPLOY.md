# Deploying to Google Cloud

This sets up the production layout from `docs/PLAN.md`. The dashboard runs on Firebase Hosting, and Firebase rewrites `/api/**` to a single Cloud Run instance, so the dashboard, API and tracking script share one origin. SQLite lives on the instance and Litestream replicates it to a GCS bucket.

For personal traffic this stays inside the free tiers. The only steady cost is Litestream's writes to GCS, which come to roughly $1 a month. The hourly and daily backups add a few cents.

Self-hosting without GCP? Use `docker compose -f infra/docker/docker-compose.yml up --build` instead (see the README).

## Prerequisites

- `gcloud`, signed in as an account that can create projects and use a billing account:
  `gcloud auth login && gcloud auth application-default login`
- Terraform ≥ 1.9, Docker with `buildx`, Node (for the dashboard build), and the Firebase CLI (`firebase login`)
- A domain whose DNS you control, e.g. `analytics.example.com`. Optionally a second, short host for the tracking script (see [Extra domains](#extra-domains))
- A **GitHub OAuth App** (Settings → Developer settings → OAuth Apps):
  - Homepage URL: `https://<domain>`
  - Authorization callback URL: `https://<domain>/api/auth/github/callback` (must match exactly)

## 1. Bootstrap: project, APIs, state bucket, budget

`infra/terraform/bootstrap` creates the GCP project, links billing, enables the APIs, creates the bucket for Terraform state and sets a monthly budget alert. It uses local state.

```sh
cd infra/terraform/bootstrap
cat > terraform.tfvars <<'EOF'
project_id      = "my-analytics"          # globally unique
billing_account = "012345-6789AB-CDEF01"  # gcloud billing accounts list
budget_currency = "USD"                   # must match the billing account's currency
monthly_budget  = 5
EOF
terraform init
terraform apply
```

The project has `deletion_policy = "PREVENT"`. To delete it, change that first.

**Move the bootstrap state off your machine.** The state starts out local, and it is the only
record of the project, billing link and budget. After the first `apply`, copy it into the state
bucket (the `main` stack keeps its state there under `main/`; this one goes under `bootstrap/`):

```sh
cp terraform.tfstate ~/terraform.tfstate.bootstrap-backup   # safety copy first
cp backend.tf.example backend.tf
terraform init -migrate-state -backend-config=bucket=<project_id>-tfstate
terraform plan   # must say: No changes
```

`backend.tf` is git-ignored on purpose: on a first run the bucket does not exist yet, so a committed
`gcs` backend would break `terraform init` for everyone else. On another machine, copy
`backend.tf.example` to `backend.tf` and run
`terraform init -backend-config=bucket=<project_id>-tfstate`. Delete the local `terraform.tfstate*`
files once `gcloud storage ls gs://<project_id>-tfstate/bootstrap/` shows the state.

## 2. Main: Cloud Run, database bucket, secret, Firebase Hosting

```sh
cd infra/terraform/main
cp terraform.tfvars.example terraform.tfvars   # set project_id, domain, extra_domains (optional), github_client_id, allowed_github_users
terraform init -backend-config=bucket=<project_id>-tfstate
terraform apply
```

The first apply deploys a placeholder image. `make deploy` replaces it, and Terraform ignores image changes from then on.

Outputs:

| Output | Use |
|---|---|
| `public_url` | Dashboard URL. The OAuth callback is `<public_url>/api/auth/github/callback`. |
| `dns_records` | Records to create for the custom domain and any extra domains (usually one CNAME each to `<site>.web.app`). |
| `image_repo` | Where `make deploy` pushes images. |
| `cloud_run_url` | Direct service URL, for debugging. |

## 3. GitHub client secret

Terraform creates the secret with a placeholder, so the real value never ends up in Terraform state. Add it with a hidden prompt (macOS):

```sh
osascript -e 'text returned of (display dialog "GitHub client secret" default answer "" with hidden answer)' \
  | tr -d '\r\n' \
  | gcloud secrets versions add github-client-secret --data-file=- --project <project_id>
```

On other systems, run `gcloud secrets versions add github-client-secret --data-file=- --project <project_id>` in a terminal, paste the secret and press Ctrl-D.

Avoid a trailing newline, because it becomes part of the secret. Cloud Run reads `latest`, so the new version is used from the next deploy or cold start.

**Rotating the secret.** If the secret leaks or you want a new one: in GitHub, open the OAuth App
(Settings, Developer settings), choose *Generate a new client secret*, add it with the command above
(it becomes the new `latest` version), then run `make deploy`. The new revision reads `latest` at startup.

Check that sign-in works, then delete the old secret in GitHub and disable the old version with
`gcloud secrets versions disable <n> --secret github-client-secret --project <project_id>`.
Sessions are not affected.

## 4. DNS

Create the records from `terraform output dns_records` at your DNS provider. Firebase verifies the domain and issues a TLS certificate on its own, which usually takes from a few minutes up to about an hour. Until then, the dashboard is reachable at `https://<site>.web.app`, but sign-in only works on the domain configured in the OAuth App.

### Extra domains

`extra_domains` serves the same site on more hostnames, for example a short, neutral host for the
tracking script next to a readable dashboard host:

```hcl
domain        = "analytics.example.com"   # dashboard, sign-in, PUBLIC_URL
extra_domains = ["t.example.com"]         # same content, script and events
```

Ad blockers often filter hostnames that contain "analytics", so sites may load
`https://t.example.com/api/script.js` instead. Do not redirect one host to the other: a redirect
breaks `POST /api/event` and `sendBeacon`. Sign-in only works on `domain`, because a GitHub OAuth App
has one callback URL. Add one CNAME per host from `terraform output dns_records`.

**Moving an existing domain.** If the host you used as `domain` before becomes an extra domain, move
it in state first so Terraform does not destroy and re-issue its certificate:

```sh
terraform state mv 'google_firebase_hosting_custom_domain.this[0]' 'google_firebase_hosting_custom_domain.extra["t.example.com"]'
terraform plan   # should only add the new primary domain and update the service
```

## 5. Deploy

```sh
gcloud auth configure-docker <region>-docker.pkg.dev   # once
make deploy                                            # or: make deploy-server / make deploy-web
```

- `deploy-server` builds a `linux/amd64` image, pushes it as `server:<git sha>` (with `-dirty` for uncommitted changes) and rolls out a new Cloud Run revision.
- `deploy-web` builds `apps/web/dist` and publishes it to Firebase Hosting.

Override `PROJECT`, `REGION` or `SERVICE` on the command line if yours differ.

## 6. Verify

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/auth/me      # 401 = API reachable through Firebase
curl -sI https://<domain>/api/script.js | head -1                          # 200
gcloud run services logs read analytics --region <region> --project <project_id> --limit 30
```

The logs should show Litestream either restoring from the bucket or reporting "no backup found, starting fresh", followed by "replicating to".

Then sign in at `https://<domain>`, add a site and embed the tracking snippet shown in the dashboard. If you use an extra domain for the script, replace the host in the snippet with it.

**`PROXY_HOPS`.** The server takes the client IP from `X-Forwarded-For`, skipping `PROXY_HOPS` trusted proxies from the right. Firebase Hosting → Cloud Run is expected to be 2. If countries show up wrong, or every visitor looks the same, check the header Cloud Run receives and adjust `proxy_hops` in `terraform.tfvars`.

The service must also be reachable on its `run.app` URL, because Firebase Hosting rewrites go
through it (disabling the default URL breaks them). A request sent there directly can forge
`X-Forwarded-For`. The server therefore also rate-limits by the address Cloud Run itself saw
(the rightmost entry), which cannot be forged.

**Abuse limits.** `ingest_rate_limit` (default 50 events/s) and `max_database_mb` (default 200)
bound how fast and how far a flood can grow the database, which on Cloud Run lives in the
instance's 512 MiB of memory. Set `alert_email` to be told about memory pressure, load
shedding, failed backups and (with `domain` set) downtime: an uptime check fetches
`/api/script.js` through the public hostname every five minutes. To remove spam afterwards, call `POST /api/sites/{id}/purge` while signed in (see
docs/API.md), since Cloud Run has no shell for `analytics events purge`.

## Operations

- **Logs:** `gcloud run services logs read analytics --region <region> --project <project_id>`
- **Backups:** the bucket `<project_id>-db` holds the Litestream replica. To restore it locally:
  `litestream restore -o analytics.db gs://<project_id>-db/analytics`
- **Standalone backups:** a Cloud Run Job (`analytics-backup`) restores the replica every hour and every day and writes a gzipped SQLite file to the separate bucket `<project_id>-backups` (`hourly/` is kept 3 days, `daily/` 90 days; see `backup_*_retention_days`). It reads the replica and never touches the running service. `make deploy` updates the job's image together with the service. After the first `terraform apply` the job uses a placeholder image, so it fails (and, with `alert_email`, sends an alert) until the first `make deploy`. To restore from a file:
  `gcloud storage cp gs://<project_id>-backups/daily/<file>.db.gz . && gunzip <file>.db.gz`, then start the server with `DATABASE_PATH` pointing at it (with Litestream, remove the old replica first).
- **Cost:** check the billing console. The budget alert emails at 50% and 90%, and at 100% of forecast spend.

## Known trade-offs

- **Scale to zero:** the first request after an idle period waits for a cold start (1–3 s, including the database restore). Events aren't lost, because the request waits.
- **Replication between requests:** with request-based billing the instance has almost no CPU between requests, so Litestream can fall behind. If an instance dies without SIGTERM, the last seconds of events can be lost.
- **Deploys:** Cloud Run briefly runs the old and new revision side by side. The new one restores from the replica while the old one still serves, so events from those few seconds can be lost. Deploy when traffic is quiet.
- **One instance:** `max_instance_count = 1`, because SQLite has a single writer. This handles far more than personal traffic needs.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `billingbudgets.googleapis.com API requires a quota project` | User credentials need a quota project. The bootstrap routes the budget through a provider with `billing_project` set. Re-run `apply` once the project exists. |
| `PERMISSION_DENIED … CONSUMER_INVALID` right after creating the project | Permissions on the new project are still propagating. Wait a minute and retry. |
| `go mod download` segfaults during `make deploy` on Apple Silicon | The Go toolchain crashes under amd64 emulation. The Dockerfile cross-compiles on the build platform (`--platform=$BUILDPLATFORM`). Make sure you're on the current Dockerfile. |
| `Secret Payload cannot be empty` | stdin wasn't a terminal (e.g. a non-interactive shell). Use the hidden-prompt command above. |
| Sign-in fails with `redirect_uri` mismatch | The OAuth App's callback URL must be exactly `https://<domain>/api/auth/github/callback`. |
| `Location 'europe-north1' is not a valid location` creating a Cloud Scheduler job | Cloud Scheduler is not available in every region. The backup schedules use `scheduler_region` (default `europe-west1`) and still trigger the job in `region`. |
| `/healthz` returns 404 on the `run.app` URL | Cloud Run reserves paths ending in `z` on its public URL. The in-container startup probe still works. |
