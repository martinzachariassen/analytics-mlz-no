# Runbook

> **TL;DR** — Production is one Cloud Run instance with SQLite. Litestream replicates the
> database to GCS, and hourly and daily backup files are kept as well. Quick health check:
>
> ```sh
> curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/auth/me   # 401 = API is up
> curl -sI https://<domain>/api/script.js | head -1                       # 200
> ```
>
> Then open `terraform output dashboard_url` (Cloud Monitoring). Each problem below has a
> playbook: **symptoms → checks → fix**.

**Read this if:** you operate the production deployment, or something looks wrong. The commands
assume the Google Cloud setup from [deploy-gcp.md](../guides/deploy-gcp.md). For Docker, the same
ideas apply with `docker compose logs` and the `analytics` CLI.

Placeholders: `<project_id>`, `<region>` (default `europe-north1`) and `<domain>` come from
`infra/terraform/main/terraform.tfvars`.

## Where to look

| What | Where |
|---|---|
| **Monitoring dashboard** | `terraform output dashboard_url`: requests by status, latency, memory and CPU, instances, backup runs, uptime, and the server's warnings and errors |
| **Error logs** | `terraform output logs_url`: Logs Explorer filtered to the server's warnings and errors |
| **Logs from a terminal** | `gcloud run services logs read analytics --region <region> --project <project_id>` (or `gcloud beta run services logs tail …` to follow) |
| **Alerts** | Email to `alert_email`: memory pressure, load shedding, failed backups, downtime (an uptime check fetches `/api/script.js` every five minutes), and any `ERROR` log line (at most one email per hour) |
| **Cost** | Billing console. The budget alert emails at 50 % and 90 % of the budget, and at 100 % of forecast spend |

The server writes JSON log lines with `severity` and `message`. Litestream's own lines (restore,
replication) are plain text without a severity.

### Useful Logs Explorer filters

| What | Filter |
|---|---|
| Server errors and warnings | `resource.type="cloud_run_revision" resource.labels.service_name="analytics" log_id("run.googleapis.com/stdout") severity>=WARNING` |
| Requests that failed (4xx/5xx) | `resource.type="cloud_run_revision" resource.labels.service_name="analytics" log_id("run.googleapis.com/requests") httpRequest.status>=400` |
| Sign-ins | `resource.type="cloud_run_revision" jsonPayload.message="signed in"` |
| Backup job | `resource.type="cloud_run_job" resource.labels.job_name="analytics-backup"` |
| Backup schedules | `resource.type="cloud_scheduler_job"` |
| Why events were rejected | `resource.type="cloud_run_revision" jsonPayload.message="event rejected"` |

A rejected event logs its `reason` (for example `missing origin` or `unknown site`), the status,
the Origin's hostname and the site id. It never logs the IP address or user agent. Bad payloads
log at `INFO`. Rate limits, bots and load shedding log only at `DEBUG`, because a flood would
otherwise flood the logs too.

<details>
<summary>Turning on debug logging temporarily</summary>

```sh
cd infra/terraform/main
terraform apply -var log_level=debug   # rolls out a new revision
# ... investigate ...
terraform apply                         # back to the value in terraform.tfvars
```
</details>

## Playbooks

### Spam, a traffic spike or a flood

**Symptoms:** a sudden spike on one page or from one country, a referrer you do not recognise, the
memory or load-shedding alert email, or `429`/`503` in the logs.

1. **Look at what is arriving:**
   ```sh
   gcloud run services logs read analytics --region <region> --project <project_id> --limit 200 \
     | grep -E ' (429|503) '
   ```
2. **Inspect before you delete.** Use the dashboard's filter bar to isolate the referrer, path or
   country, and see how many events it is.
3. **Delete the junk.** While signed in, send `POST /api/sites/{id}/purge` with a time window, and
   an exact path if it is one page (see [API](../reference/api.md#cleaning-up-spam)). With Docker
   or locally, use `analytics events purge -site ID -from ... -to ...`. Cloud Run has no shell, so
   use the API there. **Purging cannot be undone**, so use a narrow window.
4. **If the flood continues,** lower `ingest_rate_limit` or `max_database_mb` in
   `terraform.tfvars` and apply. Real traffic for a personal site is a few events per second at most.

Background: [bots.md](bots.md) explains what is filtered and what cannot be stopped.

### Wrong countries, or every visitor looks the same

**Symptoms:** all traffic comes from one country (often the hosting region), or visitor counts are
far too low.

1. Visit one of your tracked sites yourself and compare the country and visitor count in the
   realtime view with what you expect.
2. Check the `X-Forwarded-For` header Cloud Run receives, and count the proxies.
3. Fix `proxy_hops` in `terraform.tfvars` (2 for Firebase Hosting → Cloud Run) and apply. See
   [`PROXY_HOPS`](../reference/configuration.md#proxy_hops).

A wrong value also breaks per-client rate limiting.

### Service down or slow

1. Run the health check from the TL;DR. A `401` from `/api/auth/me` means the API is reachable
   through Firebase.
2. Open the monitoring dashboard: memory (the database lives in the instance's 512 MiB of memory),
   instance count and `5xx`.
3. Read the startup logs. A healthy start shows Litestream either restoring from the bucket or
   reporting "no backup found, starting fresh", followed by "replicating to".
4. The first request after an idle period waits 1–3 s for a cold start. That is expected.
5. `/healthz` returns 404 on the `run.app` URL, because Cloud Run reserves paths ending in `z`.
   That is expected too.

### Restore the database from a backup

Two kinds of backup exist:

- **Litestream replica** in the bucket `<project_id>-db`. It trails the live database by about a second.
- **Standalone backup files** in `<project_id>-backups`. The Cloud Run Job `analytics-backup`
  restores the replica every hour and every day and writes a gzipped SQLite file. `hourly/` is
  kept 3 days and `daily/` 90 days (`backup_*_retention_days`). These files survive damage to the
  replica.

To inspect a backup locally:

```sh
litestream restore -o analytics.db gs://<project_id>-db/analytics
# or from a backup file:
gcloud storage cp gs://<project_id>-backups/daily/<file>.db.gz . && gunzip <file>.db.gz
DATABASE_PATH=<file>.db make run
```

To restore production from a backup file, start the server with `DATABASE_PATH` pointing at it.
When Litestream is in use, remove the old replica first, or it is restored over your file.

### Roll back a release

Old binaries do not understand a database that a newer version has migrated, so a rollback means
restoring the database as well. See [upgrading.md](../guides/upgrading.md#rolling-back).

### Rotate the GitHub client secret

Do this if the secret leaks, or if you just want a new one.

1. In GitHub, open the OAuth App (Settings → Developer settings) and choose *Generate a new
   client secret*.
2. Add it as the new `latest` version (macOS hidden prompt):
   ```sh
   osascript -e 'text returned of (display dialog "GitHub client secret" default answer "" with hidden answer)' \
     | tr -d '\r\n' \
     | gcloud secrets versions add github-client-secret --data-file=- --project <project_id>
   ```
3. Run `make deploy`. The new revision reads `latest` at startup.
4. Check that sign-in works. Then delete the old secret in GitHub and disable the old version:
   `gcloud secrets versions disable <n> --secret github-client-secret --project <project_id>`.

Sessions are not affected.

### Remove someone's access, or sign everyone out

Do this when someone leaves, a laptop is lost, or a session cookie may have leaked.

1. Remove the username from `allowed_github_users` in `terraform.tfvars` and run
   `terraform apply` (Docker: edit `ALLOWED_GITHUB_USERS` and restart).
2. That is enough: the allowlist is checked on every request, so their next request gets `401`
   and their sessions are deleted.
3. To end sessions without changing the allowlist (for example your own, after a leak), run
   `analytics sessions revoke [-user LOGIN]` where the database file is (Docker:
   `docker compose -f infra/docker/docker-compose.yml exec analytics analytics sessions revoke`).
   On Cloud Run there is no shell next to the database: keep the user off the allowlist until
   they would have made a request (their sessions are deleted then), or sign out in the browser
   to end your own session.

Sessions also expire by themselves after 7 days without use.

### A backup job failed

1. Find the run with the "Backup job" filter above.
2. After the first `terraform apply`, the job uses a placeholder image and fails until the first
   `make deploy`. `make deploy` updates the job's image together with the service.
3. Re-run it by hand: `gcloud run jobs execute analytics-backup --region <region> --project <project_id>`.

## Routine checks

| When | Check |
|---|---|
| After the first deploy and after changing `PROXY_HOPS` | Compare your own country and visitor count against a visit you made yourself |
| Now and then | Skim the top referrers and paths in the dashboard for things you do not recognise |
| Monthly | Check that `daily/` in `<project_id>-backups` has recent files. Check the bill |
| Once a year | Renew `Expires` in `apps/web/public/.well-known/security.txt` |
| Always | Keep Dependabot and `govulncheck` (CI) enabled |

## Known trade-offs

- **Scale to zero:** the first request after an idle period waits for a cold start (1–3 s,
  including the database restore). Events are not lost, because the request waits.
- **Replication between requests:** with request-based billing, the instance has almost no CPU
  between requests, so Litestream can fall behind. If an instance dies without SIGTERM, the last
  seconds of events can be lost.
- **Deploys:** Cloud Run briefly runs the old and new revision side by side. The new one restores
  from the replica while the old one still serves, so events from those few seconds can be lost.
  Deploy when traffic is quiet.
- **What the backups cover:** together, the replica and the backup files lose at most the events
  from the two cases above. Older events are never lost, because every daily file contains all of
  them (with `retention_days = 0`).
- **One instance:** `max_instance_count = 1`, because SQLite has a single writer. This handles
  far more than personal traffic needs.

## Next steps

- [Bots, scanners and robots](bots.md)
- [Configuration](../reference/configuration.md) · [API](../reference/api.md)
