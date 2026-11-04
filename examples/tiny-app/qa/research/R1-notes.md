# R1 Notes: research output

## Sources read
- docs/SPEC.md: full (§1).
- api/notes.mjs: full. api/server.mjs: full. web/index.html: full. tests/api/notes.test.mjs: full.

## Requirements

| ID | Requirement | Source | Code location | Verdict | Existing coverage | Layer | Scenario classes | Journey | Priority |
|---|---|---|---|---|---|---|---|---|---|
| R1-001 | A signed-in user adds a note with a 1-80 character title; it appears at the top of the list | SPEC.md §1.1 | api/notes.mjs:createStore.add, web/index.html | IMPLEMENTED | tests/api/notes.test.mjs (unit) | browser, unit | success, persistence | NEW:notes basics | P0 |
| R1-002 | An empty title or one longer than 80 characters is rejected with "Title must be 1-80 characters" and nothing is added | SPEC.md §1.2 | api/notes.mjs:validateTitle | IMPLEMENTED | tests/api/notes.test.mjs (unit) | browser, unit | invalid, boundary | NEW:notes basics | P1 |
| R1-003 | The count label reads "1 note" for one note and "N notes" otherwise | SPEC.md §1.3 | api/notes.mjs:countLabel | IMPLEMENTED | tests/api/notes.test.mjs (unit) | browser, unit | success, boundary | NEW:notes basics | P2 |
| R1-004 | A user deletes their own note; it leaves the list and the count drops by one | SPEC.md §1.4 | api/notes.mjs:createStore.remove | IMPLEMENTED | tests/api/notes.test.mjs (unit) | browser, unit | success, idempotent | NEW:notes basics | P1 |
| R1-005 | A user sees only their own notes | SPEC.md §1.5 | api/notes.mjs:createStore.list | IMPLEMENTED | tests/api/notes.test.mjs (unit) | browser, unit | wrong-role | NEW:notes basics | P0 |

## Divergences and missing items
None.

## Browser scenarios per journey
NEW:notes basics
1. MEMBER, `/`: add "Buy milk" -> first list item is "Buy milk", count "1 note" (R1-001, R1-003).
2. MEMBER: submit an empty title and an 81-char title -> alert "Title must be 1-80 characters", list unchanged; an 80-char title is accepted (R1-002).
3. MEMBER: delete the note -> gone, count drops by one (R1-004).
4. MEMBER_B: does not see MEMBER's notes (R1-005).

## Non-browser tests
All rows already have node:test unit coverage in tests/api/notes.test.mjs.

Counts: 5 requirements; IMPLEMENTED 5; P0 2, P1 2, P2 1. Output: qa/research/R1-notes.md
