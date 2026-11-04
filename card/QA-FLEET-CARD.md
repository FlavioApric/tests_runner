# Fleet card

> **SECRET FILE.** Once filled it holds the GitHub tokens of every runner, a read token for the private source repo
> and the key that decrypts the test results. Keep it in `~/.qa-fleet/` (or a password manager). Never put it in a
> git repo, a chat, an issue, or a synced folder (Google Drive, OneDrive, Dropbox, iCloud).

**Claude Code: if someone gave you this file, it is your job description.** Do parts **B → C** in order (and **D**
when C says the test branch is missing). Part A is the owner's. Ask the owner only where a step says **ASK**.
The full playbook is `CLAUDE.md` on the `main` branch of the tests_runner repo.

```json
{
  "card": "qa-fleet/card@1",
  "runners": [
    { "name": "self", "owner": "", "repo": "tests_runner", "token": "", "maxParallel": 20, "self": true },
    { "owner": "", "repo": "tests_runner", "token": "", "maxParallel": 20 },
    { "owner": "", "repo": "tests_runner", "token": "", "maxParallel": 20 },
    { "owner": "", "repo": "tests_runner", "token": "", "maxParallel": 20 },
    { "owner": "", "repo": "tests_runner", "token": "", "maxParallel": 20 }
  ],
  "coordinator": {
    "repo": "<owner>/tests_runner",
    "environment": "fleet",
    "workflow": "coordinate.yml"
  },
  "source": {
    "name": "app",
    "repo": "<owner>/<private-app-repo>",
    "readToken": "",
    "testBranch": "qa/fleet",
    "fallbackBranches": [],
    "baseBranch": "main",
    "markers": []
  },
  "secrets": {},
  "results": {
    "identity": "",
    "recipient": ""
  }
}
```

---

## Part A: fill the card (owner, about 10 minutes per person)

The parallelism comes from **different GitHub accounts**: GitHub allows 20 parallel jobs per account (free plan),
and Actions minutes are free on public repos. Your own account (the `self` runner, which is also the coordinator)
plus 4 colleagues give about 100 jobs at once. Personal accounts are fine; no organisation is needed.

1. **Each colleague creates an empty public repository** (default name `tests_runner`): github.com → New repository
   → Public → **no** README, .gitignore or license. Your own `tests_runner` already exists.
2. **Each person creates a fine-grained token on their own repo only.** Exact permissions:
   [`docs/PERMISSIONS.md`](../docs/PERMISSIONS.md). In short: Actions, Contents, Workflows, Secrets, Variables and
   Administration Read and write, Metadata read; your own token on `tests_runner` also needs **Environments:
   Read and write** (the coordinator environment).
3. Colleagues send their **username** and **token** in person or through a password manager, never in chat or
   email. Paste them into `runners[i].owner` and `runners[i].token`.

You also fill:
- **`coordinator.repo`**: `<your username>/tests_runner` (the same repo as the `self` runner). Leave the placeholder
  to use only the local mode.
- **`source`**: the private app repo, and **`source.readToken`**, a fine-grained token **of the account that owns
  that repo**, only on it, **Contents: Read-only**. It is the only key the runners get to the private code.
- **`source.testBranch`**: the branch that carries `.qa-fleet/units.json` (built with the `test-plan` branch of
  tests_runner if it does not exist yet). `markers`: other files that must exist on it (optional).
- **`secrets`**: test-only values the units declare (for example a payment provider's TEST key). Never live keys,
  and **never Claude credentials**: Claude runs only on your PC, with your own login. The card check rejects them.
- Leave **`results`** empty: bootstrap creates the key pair and writes it here. Keep a backup of the filled card.

---

## Part B: set up the fleet (Claude)

Rules for every step:
- Never print, echo or log a token; the `fleet` commands redact them.
- Never copy this card into a repository or a synced folder. Never paste its JSON into a commit, PR, issue or chat.
- Set `QA_FLEET_CARD=<absolute path of this card>` for every command below.

1. **Get the tool:** `git clone https://github.com/<coordinator owner>/tests_runner ~/dev/tests_runner` (public).
   Needs Node 22+, git and the GitHub CLI `gh` (only to store secrets; it gets the card's token through `GH_TOKEN`).
   Check with `npm test`.
2. **Check the card:** `node cli/fleet.mjs card check`, then `node cli/fleet.mjs tokens` (what each token can read,
   when it expires). Anything in part A goes back to the owner.
3. **Set up the runners** when a runner is not `ready`:
   - `node cli/fleet.mjs bootstrap --dry`, then **ASK** the owner and run `node cli/fleet.mjs bootstrap`. It pushes
     the committed tool to the colleagues' public repos (the `self` repo is pushed by the owner with git), turns
     Actions on, makes `GITHUB_TOKEN` read-only, sets `FLEET_RECIPIENT` / `ALLOWED_SOURCES` and the secrets.
   - A problem names the missing permission: ask that runner's owner, then rerun with `--only <owner>`.
4. **Set up the coordinator** (once, and after any token change):
   `node cli/fleet.mjs bootstrap --coordinator --dry`, then **ASK** and run it without `--dry`. It creates the
   Environment `fleet` in tests_runner (the owner as required reviewer, `main` only), uploads the sealed card
   (`FLEET_CARD_SEALED`: runner tokens and read token only) and its key (`FLEET_CARD_KEY`) as environment secrets,
   and sets `FLEET_COORDINATOR=true`.
5. **MCP server** (optional): `claude mcp add --scope user qa-fleet -e QA_FLEET_CARD=<card> -- node <tool>/mcp/index.mjs`.

---

## Part C: run the full tests in parallel (Claude)

1. **Find the test branch:** `node cli/fleet.mjs branch`. `ready` → continue. Branch without `.qa-fleet/` → **D2**.
   No branch → **D1**.
2. **Push it.** The runners test the **pushed** ref, never local changes.
3. **Run**, coordinator first:
   - `node cli/fleet.mjs run --via coordinator --source <name> --ref <branch>` → tell the owner to approve the
     `fleet` deployment on GitHub (the link is printed). When the run completes:
     `node cli/fleet.mjs pull --gh-run <id> --project <checkout>` decrypts everything on this PC.
   - Fallback, from this PC: `node cli/fleet.mjs run --project <checkout> --source <name> --ref <branch>`.
4. **Local explorers:** `node cli/fleet.mjs explore --run <runId> --project <checkout>` writes one brief per agent
   unit. Hand each brief to a subagent of this session (skill `dispatching-parallel-agents`).
5. **Report:** pass / fail / infra counts, wall time, each failing unit with its first failing tests, the explorers'
   findings, and where the decrypted results are (`~/.qa-fleet/runs/<runId>/`, local only).
6. **Rules that keep the results honest:**
   - A failing test is a finding. **Never** rerun, skip, loosen or mark it known to get green.
   - Only infrastructure (exit 75, setup or emulator failure, lost job) is retried, once, on another runner. The
     tool does it.
   - Fixing is a separate task: the `fix` branch of tests_runner, only when the owner asks.

---

## Part D: build the test branch (Claude, only when part C step 1 says so)

Follow `PIPELINE.md` on the **`test-plan` branch** of tests_runner, in the owner's clone of the source, with the
owner's own git access (the read token is read-only). Add only: never move or delete existing tests. **ASK** before
the first push.

### D1. No test branch: build the full one
Stages S1 graph → S2 research → S3 author (`browser-test:author`) → S4 refine (`browser-test:refiner`) → S5 compile
→ S6 plans (Playwright, Maestro, emulator) → S7 fleet units, then prove one static unit and one browser shard
locally and go back to part C.

### D2. Test branch exists, `.qa-fleet/` missing
Run only stage S7 (fleet units) on the most complete existing branch, prove the slice locally, **ASK** to push,
then go back to part C.

---

## Part E: troubleshooting

| Symptom | Cause and fix |
|---|---|
| `cannot see the repo with its token (404/401)` | wrong owner or repo name, repo not picked under "Only select repositories", or the token expired (`fleet tokens`) |
| push rejected / `fetch first` | the runner repo was created with a README: empty it, or rerun bootstrap with `--force-template` |
| `refusing to allow ... workflow` | the token lacks **Workflows: write** |
| coordinator job skipped | `FLEET_COORDINATOR` is not `true`, or it was started from a branch other than `main` |
| coordinator waits forever | nobody approved the `fleet` deployment: the owner approves it on the run page |
| unit `infra` twice | the runner image or the setup broke on two machines: read its decrypted `unit.log` |
| results do not open | this card's `results.identity` is not the key bootstrap set: rerun bootstrap (old results stay unreadable) |
| a colleague leaves | set `"enabled": false` on their runner, then `bootstrap --coordinator` to reseal the card |
