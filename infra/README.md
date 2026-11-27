# QACC on AWS — setup guide

This guide moves QACC onto Amazon Web Services (AWS). Follow it top to bottom. Every
command is meant to be copied exactly. Text in `<angle brackets>` is something you
replace. If a step fails, look at **Troubleshooting** at the end before changing
anything.

You do not need to know QACC's code. You need: a Mac or Linux computer, Docker, an
AWS account where you are an administrator, and the values listed in **Before you start**.

---

## 1. What you are building

```
                Internet (people, TED webhooks)
                          │  HTTPS
                ┌─────────▼──────────┐
                │  Load balancer     │  qacc.<domain>      → web
                │  (ALB)             │  api.qacc.<domain>  → api
                └───┬────────────┬───┘
                    │            │
        ┌───────────▼──┐   ┌─────▼──────────────────┐
        │ web          │   │ api  (+ PostgREST)     │──── publishes "runs in flight"
        │ 1 container  │   │ 1 container            │     (CloudWatch metric)
        └──────────────┘   └─────┬──────────────────┘
                                 │ job queue
                   ┌─────────────▼───────┐     ┌────────────────────────┐
                   │ Redis (ElastiCache) │◄───►│ worker (+ PostgREST)   │  1 … 10 copies,
                   └─────────────────────┘     │ scans websites         │  one per QA run
                                               └──┬──────────┬──────────┘
                                                  │          │ starts on demand
                                                  │   ┌──────▼─────────┐
                                                  │   │ recorder       │ video, then stops
                                                  │   └──────┬─────────┘
                      ┌─────────────────┐   ┌─────▼──────────▼───┐   ┌──────────────┐
                      │ Database (RDS   │   │ S3 bucket (images, │──►│ CloudFront   │──► browsers
                      │ PostgreSQL 16)  │   │ videos)            │   │ (CDN)        │
                      └─────────────────┘   └────────────────────┘   └──────────────┘

  All containers run on ECS Fargate (no servers to manage) in private subnets.
  They reach the internet through one NAT gateway with a fixed IP address.
```

| Piece | AWS service | Why |
|---|---|---|
| Containers | ECS Fargate | Runs the 3 apps without servers. |
| Images | ECR | Stores the container images you build. |
| Database | RDS PostgreSQL 16 | All QACC data. Private: only the containers reach it. |
| Queue | ElastiCache (Valkey) | Hands scan jobs from api to workers. |
| Files | S3 + CloudFront | Screenshots and videos. CloudFront serves them to browsers. |
| Secrets | Secrets Manager | API keys and passwords. Containers read them at start. |
| Logs | CloudWatch Logs | Every container's output, kept 14 days. |
| Scaling | Application Auto Scaling | Starts one worker per QA run, stops idle ones. |

Everything is described in Terraform files in `infra/terraform/`. You never click
resources together in the AWS console; the scripts in `infra/aws/` run Terraform for you.

---

## 2. Before you start

### 2.1 Get these from the project owner

Put a ✔ next to each one when you have it.

| # | What | Used in |
|---|---|---|
| 1 | Read access to the QACC Git repository, branch `feat/aws-floci` | everything |
| 2 | An AWS account where you have **AdministratorAccess** | step 3 |
| 3 | The AWS region to use (default `us-east-1`) | step 4 |
| 4 | The domain, e.g. `example.com` → QACC lives at `qacc.example.com` and `api.qacc.example.com` | step 4 |
| 5 | Someone who can add DNS records for that domain (or access to its DNS) | steps 7, 9 |
| 6 | The values for `infra/aws/secrets.env` (list in step 6) | step 6 |
| 7 | `system_org_id`, `system_user_id`, TED login URL | step 4 |
| 8 | The TED owner's contact (to change webhook URLs at the end) | step 12 |

### 2.2 Install Docker

Install **Docker Desktop** (Mac/Windows) or Docker Engine (Linux) and start it.
Check it works:

```bash
docker run --rm hello-world
```

That is the only program you install. Terraform and the AWS command line run inside
Docker through the scripts.

Give Docker at least **8 GB of memory** (Docker Desktop → Settings → Resources):
building the worker image needs it.

### 2.3 Get the code

```bash
git clone <repository URL> qacc
cd qacc
git checkout feat/aws-floci
```

Run every command in this guide from this `qacc` folder.

---

## 3. Log in to AWS

The scripts use an AWS profile called `qacc`. Create it once.

**If your company uses AWS SSO / IAM Identity Center** (you log in through a web page):

```bash
docker run --rm -it -v "$HOME/.aws:/root/.aws" amazon/aws-cli:2.22.0 configure sso --profile qacc
```

Answer the questions (start URL and region come from your AWS admin), then log in
again whenever it expires with:

```bash
docker run --rm -it -v "$HOME/.aws:/root/.aws" amazon/aws-cli:2.22.0 sso login --profile qacc
```

**If you were given an access key** (an ID starting with `AKIA…` and a secret):

```bash
docker run --rm -it -v "$HOME/.aws:/root/.aws" amazon/aws-cli:2.22.0 configure --profile qacc
```

Check the login works. It prints your account number:

```bash
docker run --rm -v "$HOME/.aws:/root/.aws" -e AWS_PROFILE=qacc amazon/aws-cli:2.22.0 sts get-caller-identity
```

If you use another region than `us-east-1`, run this in every new terminal:

```bash
export AWS_REGION=<region>
```

---

## 4. Fill in the settings file

```bash
cp infra/terraform/prod.tfvars.example infra/terraform/prod.tfvars
```

Open `infra/terraform/prod.tfvars` in a text editor and replace every `<...>`:

| Setting | What to write |
|---|---|
| `region` | Same region as in step 3 (default `us-east-1`). |
| `image_tag` | Leave as is. The deploy script sets it. |
| `web_host` | `qacc.<domain>` |
| `api_host` | `api.qacc.<domain>` |
| `public_web_url` | `https://qacc.<domain>` |
| `ted_base_url` | TED login URL from the owner. |
| `system_org_id`, `system_user_id` | From the owner. |
| `ted_preview_only` | Keep `true` until the owner says QACC may write to TED for real. |
| `worker_min_count` / `worker_max_count` | `1` / `10` to start. See **Costs**. |

This file is not secret, but keep it out of Git (it is already in `.gitignore`).

---

## 5. Step 1 — a place for Terraform's notes

Terraform remembers what it created in a "state" file. This step stores it safely in
S3 so it is never lost with a laptop.

```bash
infra/aws/01-state-bucket.sh
```

✅ Done when it ends with `Done. Next: infra/aws/02-make-secrets.sh`.

---

## 6. Step 2 — secrets

```bash
cp infra/aws/secrets.env.example infra/aws/secrets.env
```

Open `infra/aws/secrets.env` and paste each value from the owner after the `=`.
The first five **must** be the same as today's QACC (TED already uses them).
`X_API_KEY` matters most: every comment QACC posts in TED uses it, with no backup.

Then:

```bash
infra/aws/02-make-secrets.sh
```

It creates `infra/terraform/prod.secrets.tfvars.json`, adding generated passwords
(database login, JWT secret, session secret, recording token). If it says `MISSING`,
fill those in and run it again. Running it again never changes the generated passwords.

⚠️ Never commit `secrets.env` or `prod.secrets.tfvars.json`, and never paste them in chat.
Both are in `.gitignore`.

✅ Done when there is no `MISSING` line.

---

## 7. Step 3 — HTTPS certificate

AWS issues a free certificate once you prove you own the domain.

```bash
infra/aws/deploy.sh --cert-only
```

Terraform shows what it will create and asks `Enter a value:`. Type `yes`.

At the end it prints `acm_validation_records`: two records like

```
name  = "_3f1c….qacc.example.com."
type  = "CNAME"
value = "_9a8b….acm-validations.aws."
```

Add **both** as CNAME records at your DNS provider (copy name and value exactly).
AWS checks them every few minutes. In the AWS console → **Certificate Manager**, the
certificate changes from *Pending validation* to *Issued*, usually within 30 minutes.

✅ Done when the certificate shows **Issued**. Leave the records in place forever (renewal uses them).

---

## 8. Step 4 — build and upload the images

First create the image repositories (type `yes` when asked):

```bash
infra/aws/deploy.sh --repos-only
```

Then build and upload:

```bash
infra/aws/03-build-push.sh
```

This takes 10–30 minutes the first time. It ends with
`Pushed tag <tag>. Next: infra/aws/deploy.sh <tag>`. **Write the tag down.**

The images are built for ARM (AWS Graviton, cheaper). On an Intel/AMD computer the
build is slower but still works.

---

## 9. Step 5 — create everything

```bash
infra/aws/deploy.sh <tag>
```

Terraform lists about 70 things to create. Type `yes`. It takes 15–25 minutes
(the database and CloudFront are the slow ones).

At the end it prints outputs. Note these:

| Output | What to do with it |
|---|---|
| `alb_dns_name` | Add two DNS **CNAME** records: `qacc.<domain>` → this value, `api.qacc.<domain>` → this value. |
| `nat_public_ip` | QACC's fixed outbound IP. Send it to the owner (some client sites must allowlist it). |
| `media_public_base_url` | Where images are served from. Needed in step 7. |

The api and worker will restart a few times until the database exists (next step).
That is expected.

---

## 10. Step 6 — the database

**A. Brand-new install (empty QACC, for testing):**

```bash
infra/aws/db-task.sh schema
```

✅ Ends with `schema ready` and `Exit code: 0`.

**B. Moving the real data from the old QACC:** follow section **14. Data migration**
instead, and only on the day agreed with the owner.

After either, restart api and worker so they connect cleanly:

```bash
infra/aws/aws.sh ecs update-service --cluster qacc-prod --service qacc-prod-api --force-new-deployment --query service.serviceName
infra/aws/aws.sh ecs update-service --cluster qacc-prod --service qacc-prod-worker --force-new-deployment --query service.serviceName
```

---

## 11. Step 7 — check it works

Wait about 5 minutes after the DNS records from step 5, then:

```bash
infra/aws/smoke-test.sh
```

All lines should say `PASS`. Then open `https://qacc.<domain>` in a browser: you should
see the QACC login page with **Continue with TED**.

---

## 12. Step 8 — tell the TED owner (switch-over)

Only when the owner says so. Send the TED owner:

1. New webhook base URL: `https://api.qacc.<domain>/webhooks/...` (same paths as today,
   only the host changes).
2. TED's `QACC_URL` allowlist must contain `https://qacc.<domain>`.
3. TED's `QACC_SSO_SECRET` stays equal to our `TED_SSO_SECRET` (unchanged).

When QACC may post to TED for real, set `ted_preview_only = false` in `prod.tfvars`
and run `infra/aws/deploy.sh <same tag>`.

---

## 13. Everyday tasks

### Release a new version

```bash
git pull
infra/aws/03-build-push.sh          # note the new tag
infra/aws/deploy.sh <new tag>
infra/aws/smoke-test.sh
```

New database changes (files in `supabase/migrations/`) are applied with:

```bash
infra/aws/db-task.sh schema
```

It only applies files it has not applied before, so it is safe to run every release.

### Go back to the previous version

```bash
infra/aws/deploy.sh <previous tag>
```

### Read the logs

AWS console → **CloudWatch** → **Log groups** → `/ecs/qacc-prod-api`, `/ecs/qacc-prod-worker`,
`/ecs/qacc-prod-web`, `/ecs/qacc-prod-recorder`, `/ecs/qacc-prod-dbtools`. Or from the terminal:

```bash
infra/aws/aws.sh logs tail /ecs/qacc-prod-worker --since 30m
```

### See how many workers are running

AWS console → **ECS** → cluster `qacc-prod` → service `qacc-prod-worker` → *Tasks*.
One worker starts for every QA run (up to `worker_max_count`); idle ones stop after about 10 minutes.

### Change how many runs can go at once

Edit `worker_max_count` in `prod.tfvars`, then `infra/aws/deploy.sh <current tag>`.
More than 10 needs a bigger database (`db_instance_class = "db.t4g.medium"`):
each worker opens up to 10 database connections.

### Turn on video recording

Set `recording_enabled = true` in `prod.tfvars`, then `infra/aws/deploy.sh <current tag>`.
Each recording starts 3 short tasks (desktop, tablet, mobile) that stop by themselves.

---

## 14. Data migration (moving the old data) — owner + DevOps together

Do this once, on the agreed day. QACC is frozen during it (about 1–2 hours).

1. **Freeze.** The owner pauses TED webhooks and waits for running scans to finish.
2. **Dump the old database.** The owner runs, on a machine that can reach the old
   database (connection string from the Supabase dashboard → *Database* → *Connection string*):

   ```bash
   docker run --rm -v "$PWD:/out" postgres:16 \
     pg_dump "<old database URL>" --schema=public --no-owner --no-privileges -Fc -f /out/qacc.dump
   ```

3. **Upload the dump.** Put `qacc.dump` in the `qacc` folder (Git ignores `*.dump`), then
   (bucket name = `media_bucket` output):

   ```bash
   infra/aws/aws.sh s3 cp qacc.dump s3://<media bucket>/migration/qacc.dump
   ```

4. **Restore it into RDS** (the database must be empty: skip step 10A):

   ```bash
   infra/aws/db-task.sh restore s3://<media bucket>/migration/qacc.dump
   ```

5. **Copy the files** (screenshots etc.) from the old storage. Safe to re-run:

   ```bash
   SUPABASE_URL=https://<old project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<old service role key> \
   infra/aws/db-task.sh copy-storage
   ```

6. **Point stored image links at the new CDN:**

   ```bash
   infra/aws/db-task.sh rewrite-urls https://<old project>.supabase.co
   ```

7. **Compare.** Run `infra/aws/db-task.sh counts` and compare each table's row count with
   the old database (the owner runs the same count there). They must match.
8. **Delete the dump** from S3 (it contains all data):

   ```bash
   infra/aws/aws.sh s3 rm s3://<media bucket>/migration/qacc.dump
   ```

   Also delete `qacc.dump` from your computer.

9. Restart api and worker (end of step 10), run the smoke test, then switch TED over (step 12).

Old videos recorded before the move stay on Google Cloud Storage; their links keep working
as long as that bucket exists.

**Going back:** the old server and database stay untouched for 2 weeks. To go back, the
TED owner points the webhooks and `QACC_URL` at the old addresses again.

---

## 15. Costs (us-east-1, approximate, per month)

| Item | Size | Cost |
|---|---|---|
| NAT gateway | 1 | ~$33 + traffic |
| Load balancer | 1 | ~$18 |
| Database | db.t4g.small, 20 GB | ~$28 |
| Redis | cache.t4g.micro | ~$12 |
| web + api | always on | ~$15 |
| worker | 1 always on (2 vCPU / 4 GB, ARM) | ~$58 |
| extra workers | only while runs go; ~$0.08 per worker-hour | ~$5–50 |
| recordings | ~5 cents each | small |
| S3, CloudFront, logs, secrets, metrics | | ~$5–10 |
| **Total** | | **~$175–225** |

To save money: `worker_min_count = 0` (saves ~$58; the first run then waits 3–5 minutes
for a worker to start).

Set a **budget alert** once: AWS console → **Billing** → **Budgets** → *Create budget* →
monthly cost budget, e.g. $250, with your email.

---

## 16. Removing everything

Only if the owner asks. The database is protected; first set `deletion_protection` off in
the AWS console (RDS → qacc-prod → Modify), then:

```bash
infra/aws/tf.sh destroy -var-file=prod.tfvars -var-file=prod.secrets.tfvars.json -var image_tag=none
```

A final database snapshot `qacc-prod-final` is kept.

---

## 17. Troubleshooting

| You see | Do this |
|---|---|
| `Unable to locate credentials` / `ExpiredToken` | Log in again (step 3). Check `AWS_PROFILE=qacc`. |
| `Missing infra/terraform/prod.tfvars` | Do step 4 (and 1, 2). |
| `Error acquiring the state lock` | Someone else is running Terraform. Wait. If nobody is, ask the owner before using `terraform force-unlock`. |
| `deploy.sh` waits forever at `aws_acm_certificate_validation` | The DNS records from step 7 are missing or wrong. Fix them; it continues by itself. |
| Image push: `tag invalid: ... already exists` | Tags cannot be overwritten. Commit your change and build again (new tag). |
| `CannotPullContainerError` | The tag in `deploy.sh` was never pushed. Run `03-build-push.sh` and use the tag it prints. |
| api/worker keep restarting, log says `password authentication failed` or `relation ... does not exist` | Database not set up yet: step 10. |
| `db-task.sh schema` fails at `00_roles.sql` with `must be superuser to create bypassrls users` | Send the log to the owner (RDS rule; needs a small change in `infra/db/00_roles.sql`). |
| Smoke test `web page loads` fails right after step 5 | DNS needs time. Wait 10 minutes. Check the CNAMEs point to `alb_dns_name`. |
| Browser shows the login page again after TED login | TED's `QACC_URL` allowlist (step 12) or a different `TED_SSO_SECRET`. |
| Workers never go above 1 | `worker_max_count` must be bigger than `worker_min_count`. Check ECS → service → *Auto Scaling*, and the CloudWatch metric `QACC / RunsInFlight`. |
| A site blocks the scanner (403) | Give the site owner the `nat_public_ip`. |
| Runs finish but no comments appear in TED (worker log: `TED comment NOT posted`) | `X_API_KEY` in `secrets.env` is wrong or empty. QACC never posts comments with `TED_API_TOKEN`. Fix it, run `02-make-secrets.sh`, then `deploy.sh`. (While `ted_preview_only = true` nothing reaches TED by design.) |

Anything else: send the owner the command you ran, the full error text, and the time.

---

## 18. Only a human can do these

Claude/automation must not do these; they need a person:

- [ ] Create the AWS account / grant AdministratorAccess
- [ ] Add DNS records (certificate, `qacc.` and `api.qacc.`)
- [ ] Fill `secrets.env` with real keys
- [ ] Type `yes` on every `deploy.sh`
- [ ] Dump the old production database
- [ ] Decide the switch-over day; change TED webhooks / `QACC_URL`
- [ ] Turn `ted_preview_only` off
- [ ] Set the budget alert

---

## Appendix — local practice copy (floci)

The same Terraform runs against **floci**, a free AWS emulator on your computer
(`infra/floci/`). It is how this setup was tested before anyone had an AWS account.
It needs ~8 GB free memory. See `infra/floci/bootstrap.sh`. Not needed for the AWS setup.
