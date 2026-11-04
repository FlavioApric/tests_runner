---
name: qa-fix
description: Fix a failing QA case of a qa-pack project properly - classify the failure, find the root cause, write the failing test first, minimal fix, verify, regression. Uses the superpowers skills when installed. Use whenever a test fails and is not a known divergence.
---

# /qa-fix <case or requirement id>

1. **Classify**: app bug / spec decision (add it to `decisions.md`, ask the owner, do not guess) / test bug.
2. **Root cause** first (superpowers `systematic-debugging`). No fix before the cause is understood.
3. **Red**: the failing step is the test, or a smaller one in the right layer (backend for a rule). Watch it fail for
   the right reason (`test-driven-development`).
4. **Minimal fix** in the repo's style; the commit message names the requirement id.
5. **Verify** (`verification-before-completion`): run the module and the modules that share the screen, table or
   function (`dependsOn` in the manifests), then `pack.mjs flow --resume`. Read the output before saying done.

Never skip, disable, quarantine or retry a test to get green. Independent defects: separate git worktrees.
superpowers is a third-party plugin (see qa-pack/SUPERPOWERS.md); without it, follow the same discipline by hand.
