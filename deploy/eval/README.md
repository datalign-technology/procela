# Procela — Evaluation build

Run the whole Procela platform on your own machine from pre-built images. No
source checkout, no build step — just Docker.

> **This is an evaluation build.** Sign-in is passwordless (dev auth), a demo
> tenant is loaded for you, and outbound email is captured locally. It is not a
> production deployment. For production, use the Helm chart or Terraform under
> [`deploy/`](../).

---

## 1. Prerequisites

- **Docker** with Compose v2 (`docker compose version`). Docker Desktop
  (macOS/Windows) or Docker Engine (Linux). ~2 GB free disk, ~2 GB RAM.
- That's it — no Node, no database to install.

## 2. Quick start

From this `deploy/eval/` folder:

```bash
cp .env.example .env          # then edit JWT_SECRET (any long random string)
docker compose -f docker-compose.eval.yml up
```

First run pulls the images and loads the demo tenant (a minute or two). When it
settles, open:

- **App:** http://localhost:3000
- **Mail inbox:** http://localhost:8025 (password-reset / "Report a problem" mail lands here)

Sign in from the login screen's **Test Accounts** — e.g. *Eleanor Briggs*
(Super Admin) or *Susan Chen* (Editor) — or type any name/email (dev auth).

Stop with `Ctrl-C`. To stop and wipe everything (including the database):

```bash
docker compose -f docker-compose.eval.yml down -v
```

## 3. What's running

| Service    | Purpose                                             | Host port |
|------------|-----------------------------------------------------|-----------|
| `frontend` | Web UI (nginx; reverse-proxies `/api` → backend)    | 3000      |
| `backend`  | API server (REST + AI + MCP)                        | 3001      |
| `postgres` | Database                                            | —         |
| `redis`    | Cache / sessions                                    | —         |
| `mailpit`  | Local SMTP catcher + web inbox                      | 8025      |
| `migrate`  | Applies the DB schema, then exits                   | —         |
| `eval-seed`| Loads the demo tenant on first boot, then exits     | —         |

The demo seed **skips itself if an organization already exists**, so
restarting the stack never wipes data you added. To reload it deliberately:

```bash
docker compose -f docker-compose.eval.yml run --rm eval-seed
```

(or use **Settings → Data → Load demo data** in the app, as a Super Admin).

## 4. Common tweaks (`.env`)

- **Pin a version** — set `PROCELA_TAG=0.1.0` (instead of `latest`) for a
  reproducible evaluation.
- **Try the AI features** — set `AI_FEATURES_ENABLED=true` and add
  `AI_PROVIDER` + the matching key (e.g. `ANTHROPIC_API_KEY`). Off by default,
  so the stack otherwise makes no external calls.
- **Pick a different demo industry** — `DEMO_INDUSTRY=healthcare` (and so on;
  see the list in `.env.example`).

## 5. Learn the product

- In the app: the **?** help icons, and the **Training Guide** (a 90-minute
  click-by-click walkthrough — `GET /api/v1/docs/training.pdf`, or linked from
  in-app help).

---

## 6. If the images are private (pull fails with "unauthorized")

GHCR packages are private until their owner makes them public. If `docker
compose up` can't pull, log in with a GitHub token that has `read:packages`:

```bash
echo "$GH_TOKEN" | docker login ghcr.io -u <your-github-username> --password-stdin
```

The maintainer can instead make the `procela-backend` / `procela-frontend`
packages **Public** once (GitHub → Packages → Package settings), after which no
login is needed.

## 7. Maintainer: publishing the images

Images are published by the **Release eval images** GitHub Actions workflow
(`.github/workflows/release-eval-images.yml`) — nothing publishes on a normal
merge. To cut an evaluation release:

```bash
git tag eval-v0.1.0 && git push origin eval-v0.1.0
```

That builds multi-arch (amd64 + arm64) `procela-backend` and `procela-frontend`
images and pushes them to `ghcr.io/<owner>/…` tagged `0.1.0`, `0.1`, `0`, and
`latest`. (Or run the workflow manually via *workflow_dispatch* for a one-off,
e.g. an `rc1` tag.)

## 8. Before you distribute this ⚠️

This folder is the technical bundle. Three things are **required and out of
scope for the code** before handing it to anyone:

1. **A license / EULA.** The repository currently has **no license**, which
   legally means "all rights reserved" — a recipient has no right to run it.
   Add the evaluation terms you want recipients to agree to (the copyright
   holder's / legal's decision). This bundle intentionally ships no license
   file so none is implied.
2. **A secrets check.** Confirm no real credentials ride along — the images
   build from source and take all config from `.env` at runtime, but verify
   nothing is committed (e.g. `git secrets` / `trufflehog`, and review the
   published image layers).
3. **A dependency-license review.** Distributing an artifact distributes its
   third-party licenses too. Run an audit (e.g. `license-checker`) and keep the
   notices.
