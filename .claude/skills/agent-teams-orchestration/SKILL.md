---
name: agent-teams-orchestration
description: "Use when a task benefits from several coordinated Claude Code instances working in parallel inside ONE session — parallel multi-lens code review, debugging with competing hypotheses, feature work split across independent modules/layers, or broad research. Triggers on phrases like 'spawn teammates', 'agent team', 'parallel review with agents', 'team of agents', 'split this across agents', and their Russian equivalents ('подними тиммейтов', 'спавни команду', 'разбей на агентов', 'параллельно командой', 'свармом'). Requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in settings.json and Claude Code v2.1.178+."
---

# Agent Teams Orchestration

## Overview

Agent Teams is an official (experimental) Claude Code feature: a **lead session**
spawns **teammates** — full, independent Claude Code instances, each with its own
context window, sharing a common task list and exchanging direct messages. You (the
main session) are the lead, addressable as `team-lead`.

**CRITICAL — the current API (v2.1.178+).** A lot of material on the web (early-2026
gists and blog posts) describes a **dead** API: `TeammateTool`, `spawnTeam`,
`TeamCreate` / `TeamDelete`, `cleanup`, `broadcast`, "poll the inboxes". **None of
that exists anymore.** The team is created **implicitly** (one per session, named
`session-<8-char session id>`); there is no setup step, and cleanup is automatic when
the session ends. If you catch yourself calling `TeamCreate` / `spawnTeam` /
`cleanup`, you are following outdated docs — stop and re-read the Quick Reference
below.

## When to Use

- **Parallel review** of a PR through several lenses (security / performance / tests).
- **Competing hypotheses** debugging: N teammates, each digging one theory and
  actively challenging the others.
- **A feature that splits into independent modules/layers** with clear file boundaries.
- **Broad research**: each teammate investigates one facet, then the lead synthesizes.

## When NOT to Use

- Sequential work, edits to the same files, or a task with tight dependencies →
  a normal session, or plain subagents (the Agent tool **without** `name`).
- You only need the *result*, with no worker-to-worker communication → plain
  subagents (cheaper: team token cost scales roughly linearly with teammate count).
- Trivial chores. A team of 3+ instances costs ×N tokens — worth it for
  research / review / parallel development, not for small stuff.

## Quick Reference — the current API

| Action | How |
|---|---|
| Spawn a teammate | **Agent** tool with a `name` param (e.g. `name: "reviewer-sec"`), `run_in_background: true`, and a full self-contained `prompt`. `subagent_type` can be anything (including custom agent definitions). |
| Plan-approval for risky tasks | `mode: "plan"` at spawn → the teammate stays read-only until the lead approves its plan. |
| Message an agent | **SendMessage** `{"to": "reviewer-sec", "summary": "5-10 words", "message": "text"}` — addressed by **name**. |
| "Broadcast" | Does not exist. Send one SendMessage per recipient. |
| Who's available | **ListAgents**. Team config lives at `~/.claude/teams/<team>/config.json` (members). |
| Create a task | **TaskCreate** `{subject, description, activeForm?}`. |
| Dependencies | **TaskUpdate** `{taskId: "2", addBlockedBy: ["1"]}` — blocked tasks auto-unblock when their blockers complete. |
| Claim a task | **TaskUpdate** `{taskId, owner: "<name>"}`, then `{taskId, status: "in_progress"}` → `"completed"` (file locking prevents races). |
| Task overview / detail | **TaskList** / **TaskGet** (call TaskGet before a TaskUpdate — state may be stale). |
| Shut a teammate down | Ask it by name to finish (the lead sends a shutdown request; the teammate may decline with a reason). |
| Cleanup | Automatic when the session ends. There is no separate step. |

Key mechanics:
- Teammate messages are **delivered automatically** — do not poll any inbox. When a
  teammate finishes its turn it sends the lead an idle-notification automatically; if
  it dies on an API error, you get an error notification.
- An agent's ordinary text output is **invisible** to other agents — only SendMessage
  crosses the boundary.
- Teammates **cannot** spawn their own teammates (they have no `name` param) and have
  no background subagents.
- A teammate inherits the project's CLAUDE.md / skills / MCP, but **not** the lead's
  conversation history → the spawn prompt must carry all task context itself.
- `/model` and `/fast` are fixed at spawn time; reasoning effort is inherited from the
  lead.

## Lifecycle (a typical run)

1. **Decompose**: TaskCreate for every chunk of work (5-6 tasks per teammate is fine);
   set `addBlockedBy` for pipeline stages.
2. **Spawn**: 3-5 teammates in a single message (parallel Agent calls). Give short,
   meaningful names (`reviewer-sec`, `research-perf`, `hypothesis-cache`). Each prompt
   must contain: the concrete files/boundaries it owns, which tasks it owns OR an
   instruction to self-claim from TaskList, and where to send results (`team-lead`).
3. **Coordinate**: wait for messages (they arrive on their own), reply with
   SendMessage, re-assign stuck tasks. Do NOT do the teammates' work yourself — if you
   catch yourself doing it, wait for the team.
4. **Synthesize**: collect results, run the final verification pass (see conventions).
5. **Shutdown**: ask each teammate to finish. Cleanup is automatic.

## Patterns

- **Parallel specialists (review)**: N teammates, each with its own lens
  (security / perf / test-coverage / simplicity) over the same diff. The lead
  synthesizes and de-duplicates findings.
- **Competing hypotheses (debug)**: N teammates, each with a different theory of the
  bug, mandated to "actively refute the others' theories via SendMessage". The
  surviving theory is almost certainly the root cause.
- **Pipeline**: tasks linked with `addBlockedBy` (research → plan → implement → test);
  teammates claim work as it unblocks, in ascending task-ID order.
- **Self-organizing pool**: M ownerless independent tasks, K < M workers each prompted
  "TaskList → take a pending task with no owner and no blockedBy → do it → mark
  completed → repeat; if empty, tell the lead and wait".

## Team conventions (adapt these to your setup)

These are house rules layered on top of the feature. They assume teammates share a
single working tree — tune them for your environment.

- **File boundaries are mandatory.** Each teammate owns a distinct set of files — two
  agents in the same file means overwrites. When committing, commit **only your own
  files** explicitly; never `git add -A` / `git add .` in a shared working tree, or you
  will sweep another agent's edits into your commit.
- **Only the lead runs the final `test` / `typecheck` / `format` / `lint` pass.**
  Teammates compete for shared test infrastructure (test DB, containers, ports) exactly
  like parallel sessions do. Tell each teammate explicitly in its prompt: "do not run
  tests / typecheck / format / lint — the lead does that at the end."
- **Dev servers**: if a teammate needs a running dev server, give each one an isolated
  port so two teammates never bind the same one.
- **Size**: start with 3-5 teammates; add more only when the work is genuinely
  independent. Worth it for review/research; not for small chores.
- **Display**: the default is `in-process` — teammates appear in the lead's agent panel
  (↑/↓ to select, Enter to open a transcript and message directly, `x` to stop,
  Ctrl+T for the task list). They do NOT show up as separate sessions. For tmux
  split-panes instead, launch with `claude --teammate-mode auto` (or set
  `"teammateMode": "auto"` in settings.json).

## Known Limitations (experimental)

- `/resume` and `/rewind` do NOT restore in-process teammates — after a resume the lead
  may message "dead" names. Fix: spawn new ones.
- Task status can get stuck (a teammate forgot to mark `completed` → dependents stay
  blocked). Check with TaskGet and update by hand, or nudge the teammate.
- Shutdown waits for the current tool call to finish — it can be slow.
- One team per session; the lead is fixed; no nested teams.
- Teammates' permission prompts surface on the lead; the permission mode is inherited
  at spawn time.

## Common Mistakes

| Symptom | Reality |
|---|---|
| Calling `TeamCreate` / `spawnTeam` / `TeamDelete` / `cleanup` | Dead pre-v2.1.178 API. The team is implicit; cleanup is automatic. |
| `SendMessage {type, recipient, content}` | The fields are `{to, summary, message}`. |
| "I'll broadcast to everyone" | No such operation — one message per name. |
| Polling inbox files / `cat inboxes/*.json` in a loop | Messages are delivered automatically; wait, don't poll. |
| Lead starts doing the teammates' tasks | Wait for the team. "Wait for your teammates to complete their tasks." |
| A teammate tries to spawn a teammate | Forbidden by the feature — only the lead manages the team. |
| All teammates edit the same file | Overwrites. Enforce file boundaries during decomposition. |
