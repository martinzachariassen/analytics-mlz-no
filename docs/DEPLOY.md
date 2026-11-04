# Deploying to Google Cloud

This sets up the production layout from `docs/PLAN.md`. The dashboard runs on Firebase Hosting, and Firebase rewrites `/api/**` to a single Cloud Run instance, so the dashboard, API and tracking script share one origin. SQLite lives on the instance and Litestream replicates it to a GCS bucket.

For personal traffic this stays inside the free tiers. The only steady cost is Litestream's writes to GCS, which come to roughly $1 a month. The hourly and daily backups add a few cents.

Self-hosting without GCP? Use `docker compose -f infra/docker/docker-compose.yml up --build` instead (see the README).

## Prerequisites

- `gcloud`, signed in as an account that can create projects and use a billing account:
  `gcloud auth login && gcloud auth application-default login`
- The repo's tools: `mise install` (Terraform, Go, Bun and the linters from `mise.toml`) and
  `bun install` (the Firebase CLI is a dev dependency; sign in with `bunx firebase-tools login`).
  Docker with `buildx` for the image.
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
| `firebase_site`, `firebase_default_url` | The Hosting site and its `web.app` URL. |
| `dashboard_url`, `logs_url` | The operations dashboard and the warnings/errors log query (see Operations). |

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

To make the dashboard's "Tracking code" page hand out the short host, build it with
`TRACKER_ORIGIN`: `make deploy-web TRACKER_ORIGIN=https://t.example.com` (it becomes
`VITE_TRACKER_ORIGIN` for Vite). Without it the snippet uses the dashboard's own origin.

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

- `deploy` runs the quality gate (`scripts/verify.sh`) and refuses to continue unless the tree is
  clean, on `main` and pushed. `FORCE=1 make deploy` skips those three checks for an emergency fix.
- `deploy-server` builds a `linux/amd64` image, pushes it as `server:<git sha>` (with `-dirty` for
  uncommitted or untracked changes) and rolls out a new Cloud Run revision and backup job image.
- `deploy-web` builds `apps/web/dist` and publishes it to Firebase Hosting. Server first, then
  web, so a new dashboard never goes live before the API it needs.

Override `PROJECT`, `REGION` or `SERVICE` on the command line if yours differ. `SERVICE` and
`REGION` are also written into `apps/web/firebase.json` (the `/api/**` rewrite); change both.

After the first deploy has data, set `require_replica = true` in `terraform.tfvars` and apply.
From then on an instance refuses to start from an empty replica, and the backup job treats an
empty replica as a failure, so a lost replica becomes an alert instead of a quiet fresh start.
Leave it `false` for the very first deploy, when the replica is empty by design.

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

- **Dashboard:** `terraform output dashboard_url` opens the "Analytics" dashboard in Cloud
  Monitoring: requests by status, latency, memory and CPU, instances, backup runs, uptime and
  the server's warnings and errors. `terraform output logs_url` opens Logs Explorer on the
  server's warnings and errors.
- **Logs:** in the console under Cloud Run → `analytics` → *Logs*, or in
  [Logs Explorer](https://console.cloud.google.com/logs/query) for search and filters. From a terminal:
  `gcloud run services logs read analytics --region <region> --project <project_id>`
  (or `gcloud beta run services logs tail …` to follow). The server writes JSON lines with
  `severity` and `message`, so the usual filters work. Useful queries in Logs Explorer:

  | What | Filter |
  |---|---|
  | Server errors and warnings | `resource.type="cloud_run_revision" resource.labels.service_name="analytics" log_id("run.googleapis.com/stdout") severity>=WARNING` |
  | Requests that failed (4xx/5xx) | `resource.type="cloud_run_revision" resource.labels.service_name="analytics" log_id("run.googleapis.com/requests") httpRequest.status>=400` |
  | Sign-ins | `resource.type="cloud_run_revision" jsonPayload.message="signed in"` |
  | Backup job | `resource.type="cloud_run_job" resource.labels.job_name="analytics-backup"` |
  | Backup schedules | `resource.type="cloud_scheduler_job"` |
  | Why events were rejected | `resource.type="cloud_run_revision" jsonPayload.message="event rejected"` |

  A rejected event logs its `reason` (for example `missing origin`, `unknown site`), the status,
  the Origin's hostname and the site id, never the IP address or user agent. Bad payloads log at
  `INFO`. Rate limits, bots and load shedding log only at `DEBUG`, because a flood would
  otherwise flood the logs too. To see them, run `terraform apply -var log_level=debug`, which
  rolls out a new revision. Set it back to `info` when you are done.

  Litestream's own lines (restore, replication) are plain text without a severity. With
  `alert_email` set, any `ERROR` line from the server sends at most one email per hour.
- **Backups:** the bucket `<project_id>-db` holds the Litestream replica. To restore it locally:
  `litestream restore -o analytics.db gs://<project_id>-db/analytics`
- **Standalone backups:** a Cloud Run Job (`<service>-backup`) restores the replica every hour and every day and writes a gzipped SQLite file to the separate bucket `<project_id>-backups` (`hourly/` is kept 3 days, `daily/` 90 days; see `backup_*_retention_days`). It reads the replica and never touches the running service. `make deploy` updates the job's image together with the service. After the first `terraform apply` the job uses a placeholder image, so it fails (and, with `alert_email`, sends an alert) until the first `make deploy`. Take one by hand with `gcloud run jobs execute <service>-backup --args daily --region <region> --project <project_id>`.
- **Cost:** check the billing console. The budget alert emails at 50% and 90%, and at 100% of forecast spend.

### Restoring the database (runbook)

When the replica is lost or damaged (the "Litestream reported a problem" alert, or a backup job
failing with "replica is empty"). Nothing here touches the running service until the last step.

1. **Stop deploying.** A deploy would start a new instance that restores from the broken replica.
2. **Pick a backup.** `gcloud storage ls gs://<project_id>-backups/hourly/` (last 3 days, hourly)
   or `.../daily/` (90 days). Fetch and unpack it:
   `gcloud storage cp gs://<project_id>-backups/daily/<file>.db.gz . && gunzip <file>.db.gz`
3. **Check it.** `sqlite3 <file>.db 'PRAGMA integrity_check; SELECT count(*), max(ts) FROM events'`
   must print `ok` and a plausible count and timestamp. The timestamp is in milliseconds since
   the epoch.
4. **Seed a new replica path** instead of overwriting the old one, so the old one stays as
   evidence: `litestream replicate <file>.db gs://<project_id>-db/analytics-<date>` and stop it
   (Ctrl-C) once it prints that the snapshot is written.
5. **Point the service at it.** Change `LITESTREAM_REPLICA_URL` in `infra/terraform/main/run.tf`
   and `backup.tf` to the new path, `terraform apply`, then `make deploy-server`. The new
   instance restores from the new path; the startup log shows the restore.
6. **Confirm** in the dashboard and with `gcloud run jobs execute <service>-backup --args daily`.
   Delete the old replica path only after a day of good backups.

Events between the backup and the restore are lost. Litestream itself keeps a few hours of
history for point-in-time restores (`litestream restore -timestamp …`); the standalone files
reach back 90 days.

## Known trade-offs

- **Scale to zero:** the first request after an idle period waits for a cold start (1–3 s, including the database restore). Events aren't lost, because the request waits.
- **Replication between requests:** with request-based billing the instance has almost no CPU between requests, so Litestream can fall behind. If an instance dies without SIGTERM, the last seconds of events can be lost.
- **Deploys:** Cloud Run briefly runs the old and new revision side by side. The new one restores from the replica while the old one still serves, so events from those few seconds can be lost. Deploy when traffic is quiet.
- **What the backups cover:** the Litestream replica trails the live database by about a second; the hourly and daily files are full copies and survive damage to the replica. Together they lose at most the events from the two cases above. Older events are never lost, because every daily file contains all of them (with `retention_days = 0`).
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
| `/healthz` returns 404 on the `run.app` URL | Cloud Run reserves paths ending in `z` on its public URL. The in-container startup and liveness probes still work; from outside, use `/api/auth/me` (401) as the health signal, which is also what the uptime check does. |
| The service starts but the dashboard is empty, and the log says "no backup found" | The replica is empty. With `require_replica = true` the instance would have refused to start; follow the restore runbook above. |
