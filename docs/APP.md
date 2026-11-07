# The fleet App: the only credential

The fleet has **one** credential: a GitHub App owned by the home repo's owner. No personal access tokens, no card.

| Who | Does once | Never again |
|---|---|---|
| Owner | `node cli/fleet.mjs setup-app` → click **Create GitHub App** | — |
| Owner | open the install link, install on the **home repo** (`tests_runner`) and the **app repos** to test | — |
| Owner | `node cli/fleet.mjs keygen` (result key: private stays on the PC) | — |
| Each other account | create an empty **public** repo named `tests_runner…`, open the install link, **Install → Only select repositories → that repo** | — |
| Owner | `node cli/fleet.mjs allow <their-login>` | — |

From then on a session only needs `gh auth login` as the owner. Every run, the coordinator (`fleet.yml`):
1. lists the App's installations → the runner repos (allowed accounts, repos named `tests_runner*`);
2. pushes the runner stub `.github/workflows/shard.yml`, pinned to the coordinator's commit, when it changed;
3. mints a **1-hour token that can only read the source repo** and sets it, plus the test secrets the units declare,
   as secrets of each runner (refreshed every 30 minutes, deleted when the run ends);
4. dispatches, watches, retries infra once elsewhere, bundles the sealed results.

## App permissions (repository)

| Permission | Access | Why |
|---|---|---|
| Actions | Read and write | dispatch the shards, read runs and jobs, download the sealed artifacts, cancel |
| Contents | Read and write | write the runner stub; read `.qa-fleet/` and check out the source (narrowed to read for the source) |
| Workflows | Read and write | the stub is a workflow file |
| Secrets | Read and write | per-run secrets on the runners |
| Administration | Read and write | turn Actions on in a new runner repo |
| Metadata | Read | always |

No account permissions, no webhook, no events. The token for the source repo is always narrowed to
`{ that repo, contents: read }`.

## Where everything lives

| Value | Where | Who can use it |
|---|---|---|
| App private key | environment secret `FLEET_APP_PRIVATE_KEY` of the home repo, environment `fleet` (main only) | `fleet.yml` on main |
| App id | variable `FLEET_APP_ID` | public |
| Result public key | variable `FLEET_RECIPIENT` | public |
| Result private key | `~/.qa-fleet/identity.key` on the owner's PC | the owner's sessions |
| Allowed accounts | variable `FLEET_ACCOUNTS` | public |
| Test secrets (test keys only) | environment secrets of `fleet`: `gh secret set STRIPE_TEST_KEY --env fleet` | copied per run to the runners whose units declare them |

## Safety

- The App is **public** so other accounts can install it. An installation on an account that is not in
  `FLEET_ACCOUNTS` (plus the owner) is ignored: a stranger's repo never receives a token or a secret.
- The owner of a runner repo can read what is set there during a run (a 1-hour read token for the source, test
  keys): lend runners only from people you trust, and put only **test** keys in the `fleet` environment.
- Each runner is reached with a token narrowed to that one repository.
- To remove a runner: its owner uninstalls the App (or you remove the login from `FLEET_ACCOUNTS`).
- To rotate the App key: App settings → Private keys → Generate, then
  `gh secret set FLEET_APP_PRIVATE_KEY --env fleet --repo <home> < key.pem`, and delete the old key.

## Concurrency

Each account gives 20 parallel jobs on the Free plan (5 for macOS). The home repo keeps one for the coordinator.
GitHub allows one free personal account per person: more capacity of your own = free organisations you own (the App
installs on an organisation the same way).
