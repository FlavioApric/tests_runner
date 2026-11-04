# Tokens and permissions

Every token is a **fine-grained personal access token** (Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token), with:

- **Resource owner:** the account that owns the repo;
- **Repository access:** *Only select repositories* → exactly **one** repo;
- **Expiration:** set one (90 days is a good default) and renew it in the card when it ends. `fleet tokens` shows
  each token's expiry.

A fine-grained token can only reach repos of **one** account. That is why every colleague creates the token for their
own runner repo: nobody can make one token that covers the others.

## 1. Runner token: each colleague, on their own runner repo

| Permission | Access | Used for |
|---|---|---|
| Actions | Read and write | dispatch `shard.yml`, read runs and jobs, download the sealed artifacts, cancel |
| Contents | Read and write | bootstrap pushes the runner code to `main` |
| Workflows | Read and write | that push contains `.github/workflows/*.yml` |
| Secrets | Read and write | bootstrap stores `SOURCE_REPO_TOKEN` and the test secrets (it only reads their names later) |
| Variables | Read and write | `FLEET_RECIPIENT` (public result key), `ALLOWED_SOURCES` |
| Administration | Read and write | turn Actions on, make the default `GITHUB_TOKEN` read-only. Can be removed after the first bootstrap |
| Metadata | Read | automatic |

Nothing else: no Issues, Pull requests, Pages, Codespaces, account permissions.

## 2. Your token: on your own `tests_runner` (runner + coordinator)

Everything in table 1, plus:

| Permission | Access | Used for |
|---|---|---|
| Environments | Read and write | `bootstrap --coordinator` creates the Environment `fleet` (you as required reviewer, `main` only) and its secrets |

Administration stays Read and write while you set up the coordinator (the environment's branch policy needs it).

## 3. Source read token: on the private app repo

| Permission | Access |
|---|---|
| Contents | **Read-only** |
| Metadata | Read (automatic) |

Owned by the account that owns the private app repo, limited to that repo. It is the **only** key the public runners
get to the private code (runner secret `SOURCE_REPO_TOKEN`), and the coordinator uses it to read
`.qa-fleet/units.json`. Never give it write access.

## What never goes anywhere

- **Claude credentials** (subscription token from `claude setup-token`, `ANTHROPIC_API_KEY`): Claude runs only on your
  PC with your own login. The card check and `units.json` validation reject them.
- **Live payment or production keys**: only test keys in the card's `secrets`.
- **The result private key** (`results.identity`): only in the card on your PC. Runners and the coordinator get only
  the public key, so the coordinator bundle can be decrypted only on your PC.

## Where each secret lives

| Value | Lives in | Who can read it |
|---|---|---|
| runner tokens, source read token | the card on your PC; sealed inside `FLEET_CARD_SEALED` | you; the coordinator job after you approve the `fleet` deployment |
| `FLEET_CARD_KEY` | Environment `fleet` secret of tests_runner | the coordinator job only |
| `SOURCE_REPO_TOKEN`, test secrets | Actions secrets of each runner repo | the unit jobs that declare them |
| `FLEET_RECIPIENT` | Actions variable (public) | anyone: it is a public key |
| `results.identity` | the card on your PC | you |
