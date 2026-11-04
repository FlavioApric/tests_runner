# Research brief: area {{AREA_ID}} {{AREA_TITLE}} ({{PROJECT}})

You are ONE of {{AREA_COUNT}} researchers working in parallel, one per area. Your area: **{{AREA_ID}} {{AREA_TITLE}}**.{{AREA_FOCUS}}

Goal: extract EVERY testable requirement of your area from the spec documents, verify each one against the code, and say how it must be tested. Your output feeds the browser-test author (S3) and the other test layers.

## Where things are
- Spec documents (read-only): {{AREA_DOCS}}. All project docs: {{ALL_DOCS}}.
- Precedence when documents disagree: {{PRECEDENCE}}.
- Code of your area: {{AREA_CODE}}. Whole app: {{APP_SRC}}.
- Function inventory (S1): `{{INVENTORY}}` (file, line, exported, callers, test files that name it).
- Knowledge graph (S1, optional): `{{GRAPH}}`. If it exists: `graphify query "<question>" --budget 3000`, `graphify path "A" "B"`, `graphify explain "X"`.
- Existing tests: {{TEST_DIRS}}.
- Personas (names only; values live in the gitignored `{{PERSONAS_FILE}}`): {{PERSONAS}}.

## Hard rules
- READ ONLY everywhere except your one output file. Do not edit code, tests or other qa files. Do not start servers, do not touch a database, do not deploy.
- Never open files that hold credentials (`.env*` contents, key files, service-account JSON); you may list variable NAMES. Never write a secret value.
- "Covered" means a test ASSERTS the rule (you opened the test and saw the assertion). Being referenced is not covered.
- Be exhaustive within your area: numbers, limits, validations, exact error messages, role permissions, state machines, flags (and flag-off behaviour), time rules, empty states, copy the spec fixes, notifications. Read every document listed for you IN FULL.

## Output: `{{OUTPUT}}`
1. **Sources read**: every file, with "full" or the exact unread ranges.
2. **Requirements table**, exactly these columns (consolidate.mjs parses them):

   `| ID | Requirement | Source | Code location | Verdict | Existing coverage | Layer | Scenario classes | Journey | Priority |`

   - ID: `{{AREA_ID}}-001`, `{{AREA_ID}}-002`, ... (must match `{{REQ_ID_REGEX}}`).
   - Requirement: one testable sentence with the exact values.
   - Verdict: IMPLEMENTED, DIVERGENT (spec value vs code value), MISSING, SPEC-CONFLICT (say which doc wins), NOT-TESTABLE-LOCALLY (why).
   - Layer: browser, api, unit, sql, edge, mobile, manual (comma list allowed).
   - Scenario classes from: success, invalid, boundary, wrong-role, idempotent, empty/error/offline, persistence, concurrency, cross-feature, flag-off.
   - Journey: an existing module id (`{{MODULE_ID_REGEX}}`) or `NEW:<short name>`; consolidate.mjs gives NEW journeys their global ids.
   - Priority: P0 = money, auth/security, data loss, core user path; P1 = main feature behaviour; P2 = cosmetic/copy.
3. **Divergences and missing items**: short list with evidence (file:line).
4. **Browser scenarios per journey**: numbered scenarios (one verifiable outcome each), persona, starting route, key steps, the exact assertion, the requirement ids.
5. **Non-browser tests**: requirements that belong to api/unit/sql/edge/mobile, with the test idea.

End your reply with: counts (requirements, by verdict, by priority) and the output path.
