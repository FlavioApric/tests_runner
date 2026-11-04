---
name: qa-access
description: Test who can open and do what in a qa-pack project - the route x persona access matrix from the router adapter, objects of other users (IDOR), sessions and tokens, redirects. Use for access, permissions, roles, login, RBAC and IDOR tests. Local stack only.
---

# /qa-access

## Safety
- Local stack or preview only; never production. Never print, log or commit a credential or a token; decode tokens
  in memory only.
- Writes only to rows the test created (random ids, deleted in `finally`) and to throw-away users. Never log out or
  change the password of a saved persona: that revokes its storage state.

## Procedure
1. Regenerate the matrix: `node qa-pack/scripts/access-matrix.mjs --project <dir>` (router adapter from qa.config
   `router.adapter`: express, react-router, json; `--check` fails when it is stale). Every route x every persona is a
   cell: `allow` or the deny result from `router.deny` (for example `status:401`).
2. Run the compiled access spec (it replays every cell and asserts the total) with Playwright.
3. Classify each failure, never retry to pass: app bug (a role reaches what it should not) -> `/qa-fix`; an
   undecided cell -> `decisions.md` with `@owner-decision`; test bug -> fix the generator or the spec.
4. Report: cells checked / passed / failed, each failure as route, persona, expected, observed; open decisions; what
   could not run and why.

## Checklist
- Matrix role x route x method from the router (a new route is picked up by the adapter; a new router style needs a
  new adapter in `qa-pack/adapters/router/`).
- IDOR: every object type of another user by deep link and by direct API with A's session, with a positive control
  (the owner sees it).
- Sessions: tampered or expired token, session after logout, hostile `return=` / `next=` redirects, rate limits.
- The visible result of each refusal (screenshot, design-contract key when one exists).

## Third-party checklists
Security skills found online are checklists to copy into this format, not code to install blindly: read the source,
pin the version, run only against the local stack.
