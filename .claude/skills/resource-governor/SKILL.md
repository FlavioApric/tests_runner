---
name: resource-governor
description: Use before any heavy LOCAL job (starting a database/app stack, an Android emulator, Maestro, a full Playwright run, a native build, npm install in a new worktree) when several Claude sessions or sub-agents share one machine. Checks free RAM and takes a named lock so parallel work does not overload the PC. Not needed for jobs that run on the cloud fleet.
---

# Resource governor

Script: `.claude/skills/resource-governor/governor.mjs` (Node, no dependencies, any OS).

## Rules
1. Light work (reading, editing, unit tests, lint, type checks, one Playwright spec) runs freely and in parallel.
2. Heavy work takes a lock first and releases it right after, also on failure. Suggested lock names:
   - `stack`: start or reset the shared local stack. Only ONE stack per machine; sessions reuse it. Do not stop a stack you did not start.
   - `emulator`: Android emulator plus Maestro. One emulator per machine.
   - `native-build`: Gradle or Xcode builds.
   - `playwright-full`: full or multi-project Playwright suites.
3. `acquire` waits until the lock is free AND free RAM is at least `GOVERNOR_MIN_FREE_GB` (default 6). Default timeout 60 min: then report to the coordinator and keep doing light work.
4. Before `npm ci` in a new worktree, run `status`; prefer `npm ci --prefer-offline`.
5. Never kill processes you did not start.
6. Anything big enough to need a long lock is a candidate for the cloud fleet instead (`fleet` skill).

## Commands
```bash
node .claude/skills/resource-governor/governor.mjs status
node .claude/skills/resource-governor/governor.mjs acquire stack <session-name> 60
node .claude/skills/resource-governor/governor.mjs release stack <session-name>
```
Locks live in `GOVERNOR_DIR` (default `<tmp>/claude-governor`). Locks older than `GOVERNOR_STALE_MIN` (90) count as stale.

## With parallel agents
- Independent sub-tasks go to parallel sub-agents (`dispatching-parallel-agents`), each in its own workspace (`git-worktree-isolation` / `using-git-worktrees`).
- Batch heavy checks: collect several and run them in one lock window instead of many small ones.
