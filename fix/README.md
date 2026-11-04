# Bug-fix playbook

How a reported bug becomes a verified fix for the users, fast and the same way every time, in any repository. All project values live in one file, `fix.config.json`.

## For the owner: how to report
Write to Claude: `fix: <what is wrong>`. The more of these you give, the faster it goes (none is required):
- where it happens (screen, role, device, web or app);
- what you did, what you expected, what you got (a screenshot is enough);
- a bug id if it is already listed.

Claude then follows [`PLAYBOOK.md`](PLAYBOOK.md), asks only if the report cannot be reproduced, and comes back with a PR and one command or approval for you.

## What you do at the end
`node scripts/fix/ship.mjs <PR>` prints it, from `ownerActions` in the config. With the example config:

| The fix is | You do |
|---|---|
| `web` | approve `deploy-web` on the runner, or merge the PR |
| `function` | approve `deploy-functions` with the function names |
| `migration` | approve `ship-migration` with the version (one additive migration) |
| `native` | a store build; the fast path cannot carry it. Claude says so before you spend time. |

See [`DELIVERY.md`](DELIVERY.md) for the details.

## Install in a project
1. Copy `scripts/fix/`, `fix/` (at least `templates/`, `bugs/README.md`, `LOG.md`) and `.claude/skills/{fix,fix-ship,qa-fix}` into the project.
2. Copy `fix.config.json` to the project root and edit it ([`CONFIG.md`](CONFIG.md); a fuller example is in [`examples/`](examples/)). Check the rules with `node scripts/fix/gate.mjs --files <a,b,c> --list`.
3. Optional: a runner repo with the workflows from [`runner-templates/`](runner-templates/).

## Files
| File | What it is |
|---|---|
| [`PLAYBOOK.md`](PLAYBOOK.md) | the steps, with the skill to use in each |
| [`CONFIG.md`](CONFIG.md) | every key of `fix.config.json` |
| [`SKILLS.md`](SKILLS.md) | which skill when |
| [`FEATURES.md`](FEATURES.md) | new features: documented, tested, a new test module on the tests branch |
| [`DELIVERY.md`](DELIVERY.md) | how a fix reaches users; who runs what |
| `templates/BUG.md`, `templates/PR.md` | the bug card and the PR text |
| `bugs/` | one card per bug |
| [`LOG.md`](LOG.md) | one row per delivered fix (append only) |
| `runner-templates/` | GitHub Actions: read-only verify, approval-gated deploy adapters |
| `../scripts/fix/` | `start.mjs`, `gate.mjs`, `ship.mjs`, `fix-batch.mjs`, `lib.mjs` |
| `../.claude/skills/` | the `/fix`, `/fix-ship` and `/qa-fix` commands |
