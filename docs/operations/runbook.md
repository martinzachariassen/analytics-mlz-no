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
| **Alerts** | Email to `alert_email`: memory pressure, load shedding, a failed backup run, no successful backup for 2 hours, downtime (an uptime check asks for `/api/auth/me` through Firebase Hosting every five minutes and expects `401`), Litestream errors or an empty restore ("no backup found"), and any `ERROR` log line (at most one email per hour) |
| **Liveness** | Cloud Run probes `/healthz` inside the container every 30 s and restarts the instance after 3 failures |
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
3. Read the startup logs. A healthy start shows Litestream restoring from the bucket (or, on the
   very first deploy only, "no backup found, starting fresh"), followed by "replicating to". With
   `require_replica = true` an empty replica stops the start instead; see
   [Restore the database from a backup](#restore-the-database-from-a-backup).
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

Litestream keeps hours of point-in-time history; the backup files reach back 90 days.

**Symptoms:** the "Litestream reported a problem" alert, a backup run failing with "the replica is
empty", an instance that refuses to start because the replica is empty (`require_replica = true`),
or a dashboard that is suddenly empty.

To restore production on Cloud Run:

1. **Stop deploying.** A new revision restores from the replica, so it would start from the same
   bad state.
2. **Pick a file.** List `gs://<project_id>-backups/hourly/` (3 days) and `daily/` (90 days),
   then fetch the newest good one:
   ```sh
   gcloud storage ls gs://<project_id>-backups/hourly/ gs://<project_id>-backups/daily/
   gcloud storage cp gs://<project_id>-backups/daily/<file>.db.gz . && gunzip <file>.db.gz
   ```
3. **Check it.** `ts` is in milliseconds:
   ```sh
   sqlite3 <file>.db 'PRAGMA integrity_check; SELECT count(*), max(ts) FROM events'
   ```
4. **Seed a new replica path** from the file, so nothing old is restored over it:
   ```sh
   litestream replicate <file>.db gs://<project_id>-db/analytics-<date>
   ```
   Leave it running until the first snapshot is uploaded. Check from another terminal with
   `gcloud storage ls -r gs://<project_id>-db/analytics-<date>`; once files are listed, stop it
   with Ctrl+C.
5. **Point the service and the backup job at it.** Set `replica_path = "analytics-<date>"` in
   `infra/terraform/main/terraform.tfvars` and run `terraform apply`. That rolls out a new
   revision that restores from the new path; no image build or deploy is needed.
6. **Confirm.** Run a backup by hand (below) and check that it writes a file, and that the
   dashboard shows data. Delete the old replica path after a day.

Events between the backup file and the restore are lost.

With Docker, stop the container, put the file in the data volume as `analytics.db`, and point
`LITESTREAM_REPLICA_URL` at a new path (or remove the old replica), or the old replica is
restored over your file.

### A deploy failed

Every merge to `main` deploys through the **Deploy** workflow once CI has passed
([deploy guide](../guides/deploy-gcp.md#deploy-on-merge-to-main-github-actions)).

1. Open the failed run under Actions → Deploy. The step name says how far it got: a failure at
   "Server to Cloud Run" leaves the previous revision serving (Cloud Run only switches traffic
   to a revision that starts); a failure at "Dashboard to Firebase Hosting" means the new server
   is live with the previous dashboard, which is safe because the server ships first.
2. If the new revision itself is broken, send traffic back to the previous one while you fix it.
   Only when the change did not migrate the database; otherwise see
   [upgrading.md](../guides/upgrading.md#cloud-run):
   ```sh
   gcloud run revisions list --service analytics --region <region> --project <project_id>
   gcloud run services update-traffic analytics --to-revisions <previous-revision>=100 --region <region> --project <project_id>
   ```
   Traffic now stays pinned, and later deploys create revisions that get none. Once the fix is
   deployed, unpin with
   `gcloud run services update-traffic analytics --to-latest --region <region> --project <project_id>`.
   Old images are kept for 7 days (and the newest 3), so roll back within that window. Roll the
   dashboard back from the release history under Hosting in the Firebase console.
3. Merge the fix; it deploys like any other change. For a transient failure (a registry or API
   hiccup), re-run the failed jobs instead. `make deploy` remains the fallback when Actions is
   down, but not while a Deploy run is in progress.

A run that says "Not deploying …: main is now …" is not a failure: a newer merge overtook it and
deploys in its own run. Rarely, `main` moves in the seconds between that check and the checkout;
the run then fails at "Deploy only the commit CI tested" before touching anything, and the newer
commit still deploys in its own run.

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
3. Roll out a new revision: re-run the latest **Deploy** workflow run (Actions → Deploy →
   *Re-run all jobs*) or run `make deploy`. The new revision reads `latest` at startup.
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

Sessions also expire by themselves after 7 days without use, and 30 days after sign-in at the latest.

### A backup job failed

1. Find the run with the "Backup job" filter above.
2. After the first `terraform apply`, the job uses a placeholder image and fails until the first
   deploy. Every deploy (the Deploy workflow or `make deploy`) updates the job's image together
   with the service.
3. If it failed with "the replica is empty but BACKUP_EXPECT_DATA=1", the replica has lost its
   data: follow [Restore the database from a backup](#restore-the-database-from-a-backup).
4. Re-run it, or take a backup by hand at any time (the job is named `<service_name>-backup`,
   `analytics-backup` by default):
   `gcloud run jobs execute analytics-backup --args daily --region <region> --project <project_id>`.

> [!TIP]
> Set `require_replica = true` in `terraform.tfvars` once the service has data. Then an empty
> replica stops the service from starting empty and fails the backup job, instead of both
> quietly carrying on with nothing.

### Litestream compaction fails

**Symptoms:** the "Litestream reported a problem" alert, and a log line like this every few
minutes, with the same transaction ids every time:

```text
level=ERROR msg="compaction failed" system=store db=analytics.db level=2 error="write ltx file: extract timestamp from LTX header: non-contiguous transaction ids in input files: (…0190,…0191) -> (…0191,…0191)"
```

**Cause:** two instances replicated at the same time, usually a deploy or a burst of requests on
a cold start that briefly ran a second instance (see [Known trade-offs](#known-trade-offs)).
Both wrote the same transaction ids, so one compaction level now has overlapping files, and
every compaction into the next level stops at them. Replication, restores and the backup job
keep working, because a restore steps over the overlap. Nothing is lost by the error itself, but
the higher levels stop advancing and the lower one keeps growing until it is fixed.

1. **Find the overlap.** It is read-only:
   ```sh
   scripts/check-replica.sh gs://<project_id>-db/analytics
   ```
   It lists every overlap and gap per level, and which files to drop to leave one chain.
2. **Check that the restore is sound.** Take a backup now and check it:
   ```sh
   gcloud run jobs execute analytics-backup --args daily --region <region> --project <project_id> --wait
   gcloud storage cp "$(gcloud storage ls gs://<project_id>-backups/daily/ | sort | tail -1)" backup.db.gz
   gunzip -f backup.db.gz && sqlite3 backup.db 'PRAGMA integrity_check;'   # must print "ok"
   ```
3. **Keep a copy of the replica.** The bucket has no object versioning, so a deleted file is gone:
   `gcloud storage cp -r gs://<project_id>-db/analytics ./replica-copy`.
4. **Compare the files that overlap.** `gcloud storage ls -l` on that level shows their sizes. A
   file of 191 bytes is only a header, a transaction with no page changes, so dropping it loses
   nothing. If both copies carry pages, the two instances wrote different data; the live
   database comes from the restore, so keep the chain a restore would pick and drop the rest.
5. **Drop the files the script lists** (only when it reports no gap):
   ```sh
   gcloud storage rm gs://<project_id>-db/analytics/ltx/1/<file>.ltx …
   scripts/check-replica.sh gs://<project_id>-db/analytics   # must print "ok"
   ```
6. **Confirm.** Within five minutes the log shows `compaction complete … level=2`, and the error
   stops.

<details>
<summary>Doing nothing also fixes it, eventually</summary>

Litestream deletes lower-level files older than the oldest daily snapshot it keeps (24 hours).
About two days after the overlap, the overlapping files age out and compaction resumes on its
own. Until then, the alert emails at most once an hour.

</details>

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
  Deploy when traffic is quiet (with the Deploy workflow: merge to `main` when traffic is quiet).
- **What the backups cover:** together, the replica and the backup files lose at most the events
  from the two cases above. Older events are never lost, because every daily file contains all of
  them (with `retention_days = 0`).
- **One instance:** `max_instance_count = 1`, because SQLite has a single writer. This handles
  far more than personal traffic needs. The cap is not absolute: a burst of requests on a cold
  start can briefly start a second instance (it happened twice in November 2026). Each restores
  and writes on its own, so events sent to the instance that stops first can be lost, and the
  replica can end up with overlapping files. That stops Litestream's compaction until it is
  fixed; see [Litestream compaction fails](#litestream-compaction-fails).

## Next steps

- [Bots, scanners and robots](bots.md)
- [Configuration](../reference/configuration.md) · [API](../reference/api.md)
