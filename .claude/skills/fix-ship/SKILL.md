---
name: fix-ship
description: Check a finished fix (PR or local branch) and give the owner the exact command or approval to deliver it, from fix.config.json ownerActions. Use after a fix PR is open, or when the owner asks "how do I get this live" or "ship it". Never writes to production.
---

# /fix-ship <PR>

1. `node scripts/fix/ship.mjs <PR>` (or `--local` before a PR exists): checks the branch name, the bug card, the regression test, the log row, the test-ticket reference, that no result files are in the diff and that the change has no blocking type. Fix any FAIL before going on.
2. Optional read-only gate on the runner: the commands `ship.mjs` prints under "Read-only check" (`readOnlyChecks`, for example the `verify.yml` template), then `gh run watch`.
3. Check the test ticket (`fix/PLAYBOOK.md` step 8): a requirement id and a commit on the tests branch are named in the card and the PR, or the card says why the bug is already covered.
4. Tell the owner, in a few lines: the delivery type, the exact command or the workflow to approve (`fix/DELIVERY.md`), what it does, and what to check afterwards.
5. After the owner confirms: fill the card ("Delivery") and append the log row in a follow-up commit on the fix branch.

Claude does not merge to the production branch, deploy, apply migrations or set flags: those are production writes and belong to the owner. If the owner has set up a runner Environment with a required reviewer, Claude may start a gated workflow; GitHub pauses until the owner approves. If that start is refused, give the owner the one-line command instead; never look for a way around the refusal.
