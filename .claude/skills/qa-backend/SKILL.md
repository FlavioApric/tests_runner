---
name: qa-backend
description: Run or write backend tests of a qa-pack project through its backend adapter (node-test, or the optional supabase adapter for migrations, SQL and edge functions). Use for any API, database, RPC or server function check (gate G3).
---

# /qa-backend

Run: `node qa-pack/runners/backend.mjs --project <dir> --layer all|<name>` (`--dry` lists the layers). Exit 0 green,
1 red, 3 deferred (it prints the missing capability). Adapters live in `qa-pack/adapters/backend/<name>.mjs` and export
`layers(cfg)`; pick one with qa.config `backend.adapter` (`none` makes G3 not applicable).
Write tests in the project's style: `node --test` files in `backend.tests`; for supabase, `*.test.sql` in
`backend.sql` (one transaction, roles by `set local role`, fixed ids, `ON_ERROR_STOP`) and `*.test.mjs` in
`backend.edge` against `QA_FUNCTIONS_URL`. Put a requirement id in a title only when the test asserts it. A file that
still contains `backend.scaffoldMarker` (default `QA-SCAFFOLD`) is a pending scaffold and keeps the layer red. Local
stack only, never production.
