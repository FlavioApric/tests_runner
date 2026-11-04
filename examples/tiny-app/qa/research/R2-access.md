# R2 Access: research output

## Sources read
- docs/SPEC.md: full (§2). api/server.mjs: full. web/index.html: full.

## Requirements

| ID | Requirement | Source | Code location | Verdict | Existing coverage | Layer | Scenario classes | Journey | Priority |
|---|---|---|---|---|---|---|---|---|---|
| R2-001 | A guest calling a session API gets 401 "Sign in required" and the page shows the sign-in form | SPEC.md §2.1 | api/server.mjs:allowed | IMPLEMENTED | none | browser, api | wrong-role | NEW:access | P0 |
| R2-002 | Wrong credentials get 401 "Invalid credentials" and the user stays signed out | SPEC.md §2.2 | api/server.mjs POST /api/login | IMPLEMENTED | none | browser, api | invalid | NEW:access | P0 |
| R2-003 | Deleting another user's note answers 404 and the note survives | SPEC.md §2.3 | api/notes.mjs:createStore.remove | IMPLEMENTED | tests/api/notes.test.mjs (unit) | api, unit | wrong-role | NEW:access | P0 |
| R2-004 | Admin stats: admin 200, member 403 "Forbidden", guest 401 | SPEC.md §2.4 | api/server.mjs GET /api/admin/stats | IMPLEMENTED | none | api | wrong-role | NEW:access | P0 |

## Divergences and missing items
None.

## Browser scenarios per journey
NEW:access
1. GUEST, `/`: sign-in form visible; GET /api/notes is 401 (R2-001).
2. GUEST: sign in with a wrong password -> alert "Invalid credentials", form still shown (R2-002).
3. MEMBER_B: DELETE MEMBER's note id -> 404, MEMBER still has it (R2-003).
4. Access matrix over every route x persona (R2-004).

## Non-browser tests
R2-003 unit coverage exists. The access matrix spec covers R2-004 for every persona.

Counts: 4 requirements; IMPLEMENTED 4; P0 4. Output: qa/research/R2-access.md
