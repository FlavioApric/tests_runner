# Runner templates

GitHub Actions workflows for a separate **runner repository** (it can be public, so the minutes are free, while the source repo stays private). Copy them into the runner's `.github/workflows/`. All are `workflow_dispatch` only (`verify.yml` can also be called by `deploy-web.yml`); action versions are pinned by commit SHA. No secret values are in these files: they only name secrets the owner creates.

| File | Writes? | What it does |
|---|---|---|
| `verify.yml` | no | checks out a ref of a source repo with a read-only token and runs `scripts/fix/gate.mjs` (the source's own `fix.config.json` picks the checks); fails on a blocking delivery type |
| `verify-release.yml` | no | waits until a public release URL contains a commit |
| `deploy-web.yml` | yes, gated | gates the PR, then after approval merges it and calls a deploy hook; optionally waits for the release URL |
| `deploy-functions.yml` | yes, gated | example adapter: deploys Supabase edge functions by name |
| `ship-migration.yml` | yes, gated | example adapter: applies ONE additive Postgres migration on Supabase, with its history row, refusing DROP/TRUNCATE unless confirmed |

## Setup (owner)
- Repository secret `SOURCE_REPO_TOKEN`: read-only on the source repos (contents and pull requests: read).
- Repository variable `SOURCE_REPOS`: space-separated allowlist (`owner/name`). Every workflow refuses other repos.
- Environment `production` with a required reviewer, created **before** the first write workflow runs. Write secrets go there only: `SOURCE_WRITE_TOKEN` (pull requests: write, to merge), `DEPLOY_HOOK_URL`, `SUPABASE_ACCESS_TOKEN`. Environment secrets reach a job only after the approval.
- Variables as needed: `SUPABASE_PROJECT_REF`, `MIGRATIONS_DIR`, `RELEASE_URL`, `INSTALL_DIRS`, `NODE_VERSION`.

## Adapting a deploy adapter
Keep the shape: dispatch-only trigger, `confirm: YES`, input validation by regex, the repo allowlist, `environment: production`, `permissions: contents: read`, a read-only checkout with `persist-credentials: false`, and inputs passed through `env:` rather than expanded inside `run:`. Replace only the provider steps. Pin any new action by its full commit SHA.

Then point `ownerActions` and `readOnlyChecks` in the source's `fix.config.json` at these workflow names.
