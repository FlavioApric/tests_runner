# R3 Look: research output

## Sources read
- docs/SPEC.md: full (§3). web/index.html: full.

## Requirements

| ID | Requirement | Source | Code location | Verdict | Existing coverage | Layer | Scenario classes | Journey | Priority |
|---|---|---|---|---|---|---|---|---|---|
| R3-001 | The header shows "Tiny Notes" in bold 24px white on the brand blue | SPEC.md §3.1 | web/index.html header | IMPLEMENTED | none | browser | success | NEW:notes basics | P2 |
| R3-002 | Every button is at least 44x44 CSS px | SPEC.md §3.2 | web/index.html button css | IMPLEMENTED | none | browser | boundary | NEW:notes basics | P2 |
| R3-003 | Text contrast is at least 4.5:1 | SPEC.md §3.3 | web/index.html :root vars | IMPLEMENTED | none | browser | success | NEW:notes basics | P2 |

## Divergences and missing items
None.

## Browser scenarios per journey
NEW:notes basics: design contract `notes-home` (header, button size, contrast) checked on the signed-in home, mobile and desktop.

## Non-browser tests
None.

Counts: 3 requirements; IMPLEMENTED 3; P2 3. Output: qa/research/R3-look.md
