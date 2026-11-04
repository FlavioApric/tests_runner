# Delivery: how a fix reaches the users

Each changed file maps to a delivery type (`deliveryRules` in `fix.config.json`); the highest type in `deliveryOrder` decides how the fix ships. The table below is the example config; edit both together.

## By type of change
| Type | Example paths | Path | Time to users |
|---|---|---|---|
| `web` | `src/`, `public/`, `index.html`, `package.json` (no native plugin change) | owner approves `deploy-web` (gate, merge, deploy hook) or merges the PR | the web build time; for apps that load the web bundle over the air, also the time for the app to fetch it (often: two opens) |
| `function` | `functions/` | owner approves `deploy-functions` with the function names | minutes after the deploy |
| `migration` | `db/migrations/` | additive only; owner approves `ship-migration` with the version | live after the run |
| `native` | `android/`, `ios/`, `capacitor.config.*`, native plugin dependencies (`nativeDeps`) | a store build | store review time |
| flag or config row | (not a file) | owner, from the admin panel or a script Claude prepares | immediate |

`scripts/fix/gate.mjs` prints the type and exits 1 for a blocking type (`blockingTypes`), so nobody waits for a fast path that cannot carry the change. `nativeDeps` makes a change of matching dependencies in the manifest count as that type even though the manifest itself maps to `web`.

## Order when a fix has several parts
Ship the lower layers first: migration, then function, then web. The new code must work with the old database for the minutes in between; if it cannot, say so in the PR and ship in that order with a check after each step.

## Who runs what
- **Claude:** local work, tests, the PR (when pushes are allowed), read-only runner workflows (`readOnlyChecks`, for example `verify.yml`, `verify-release.yml`), and the exact command for the owner.
- **Owner:** anything that writes to production: merge to the production branch, deploy, migration, secrets, flags. A tool or classifier that blocks Claude from these is doing its job; this playbook does not work around it.
- **Gated runner workflows** ([`runner-templates/`](runner-templates/)) run their writing job in a GitHub Environment with a required reviewer: Claude may start one, GitHub pauses until the owner approves, then it runs. If Claude may not start it, the owner starts it from the Actions tab.

## After delivery
- `verify-release.yml` (read-only) waits until a public release URL (a manifest or version endpoint) contains the commit.
- Check on a real device or browser that the new version is there and the bug is gone.
- Fill the card, append the log row.

## One-time setup (owner)
1. Create a runner repository (public runners are free for public repos; the source repo can stay private). Copy the templates from `runner-templates/` into its `.github/workflows/`.
2. Repository secret `SOURCE_REPO_TOKEN` (read-only on the source repos) and variable `SOURCE_REPOS` (space-separated allowlist of `owner/name`).
3. Create the Environment `production` with you as required reviewer **before** the first write workflow runs: a workflow that names a missing environment creates it without a reviewer, and nothing pauses. Put the write secrets there (for example `SUPABASE_ACCESS_TOKEN`, `DEPLOY_HOOK_URL`, `SOURCE_WRITE_TOKEN`), never as repository secrets.
4. Set `runnerRepo`, `repo`, `ownerActions` and `readOnlyChecks` in `fix.config.json` to match.

Until step 3 is done, the owner's own local commands are the way to deliver; put them in `ownerActions`.
