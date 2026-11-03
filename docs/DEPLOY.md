# Deploying to Google Cloud

This sets up the production layout from `docs/PLAN.md`. The dashboard runs on Firebase Hosting, and Firebase rewrites `/api/**` to a single Cloud Run instance, so the dashboard, API and tracking script share one origin. SQLite lives on the instance and Litestream replicates it to a GCS bucket.

For personal traffic this stays inside the free tiers. The only steady cost is Litestream's writes to GCS, which come to roughly $1 a month.

Self-hosting without GCP? Use `docker compose -f deploy/docker-compose.yml up --build` instead (see the README).

## Prerequisites

- `gcloud`, signed in as an account that can create projects and use a billing account:
  `gcloud auth login && gcloud auth application-default login`
- Terraform ≥ 1.9, Docker with `buildx`, Node (for the dashboard build), and the Firebase CLI (`firebase login`)
- A domain whose DNS you control, e.g. `t.example.com`
- A **GitHub OAuth App** (Settings → Developer settings → OAuth Apps):
  - Homepage URL: `https://<domain>`
  - Authorization callback URL: `https://<domain>/api/auth/github/callback` (must match exactly)

## 1. Bootstrap: project, APIs, state bucket, budget

`infra/bootstrap` creates the GCP project, links billing, enables the APIs, creates the bucket for Terraform state and sets a monthly budget alert. It uses local state.

```sh
cd infra/bootstrap
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

## 2. Main: Cloud Run, database bucket, secret, Firebase Hosting

```sh
cd infra/main
cp terraform.tfvars.example terraform.tfvars   # set project_id, domain, github_client_id, allowed_github_users
terraform init -backend-config=bucket=<project_id>-tfstate
terraform apply
```

The first apply deploys a placeholder image. `make deploy` replaces it, and Terraform ignores image changes from then on.

Outputs:

| Output | Use |
|---|---|
| `public_url` | Dashboard URL. The OAuth callback is `<public_url>/api/auth/github/callback`. |
| `dns_records` | Records to create for the custom domain (usually one CNAME to `<site>.web.app`). |
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

## 4. DNS

Create the records from `terraform output dns_records` at your DNS provider. Firebase verifies the domain and issues a TLS certificate on its own, which usually takes from a few minutes up to about an hour. Until then, the dashboard is reachable at `https://<site>.web.app`, but sign-in only works on the domain configured in the OAuth App.

## 5. Deploy

```sh
gcloud auth configure-docker <region>-docker.pkg.dev   # once
make deploy                                            # or: make deploy-server / make deploy-web
```

- `deploy-server` builds a `linux/amd64` image, pushes it as `server:<git sha>` (with `-dirty` for uncommitted changes) and rolls out a new Cloud Run revision.
- `deploy-web` builds `web/dist` and publishes it to Firebase Hosting.

Override `PROJECT`, `REGION` or `SERVICE` on the command line if yours differ.

## 6. Verify

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/auth/me      # 401 = API reachable through Firebase
curl -sI https://<domain>/api/script.js | head -1                          # 200
gcloud run services logs read analytics --region <region> --project <project_id> --limit 30
```

The logs should show Litestream either restoring from the bucket or reporting "no backup found, starting fresh", followed by "replicating to".

Then sign in at `https://<domain>`, add a site and embed the tracking snippet shown in the dashboard.

**`PROXY_HOPS`.** The server takes the client IP from `X-Forwarded-For`, skipping `PROXY_HOPS` trusted proxies from the right. Firebase Hosting → Cloud Run is expected to be 2. If countries show up wrong, or every visitor looks the same, check the header Cloud Run receives and adjust `proxy_hops` in `terraform.tfvars`.

## Operations

- **Logs:** `gcloud run services logs read analytics --region <region> --project <project_id>`
- **Backups:** the bucket `<project_id>-db` holds the Litestream replica. To restore it locally:
  `litestream restore -o analytics.db gs://<project_id>-db/analytics`
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
| `/healthz` returns 404 on the `run.app` URL | Cloud Run reserves paths ending in `z` on its public URL. The in-container startup probe still works. |
