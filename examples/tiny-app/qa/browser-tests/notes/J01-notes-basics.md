# J01 Notes basics

## Summary
A signed-in member adds, counts and deletes their own notes on the home page, and never sees another member's
notes. A correct result: the exact title at the top of the list, the spec message for invalid titles with nothing
saved, the count label of the spec, and the look of section 3 of the spec (header, touch targets, contrast).

## Preconditions
- **Standard preconditions** (see qa-pack/conventions.md)
- **Environments:** local
- **Markers:** @planned @notes-basics @J01

## Before Hook

### Setup 0. Fixture preflight
None: the app starts empty (api/seed.json has users only). The auth setup signs MEMBER and MEMBER_B in once.

### Setup 1. Standard preconditions
Personas MEMBER and MEMBER_B (env `QA_MEMBER_USER` / `QA_MEMBER_PASSWORD`, `QA_MEMBER_B_USER` / `QA_MEMBER_B_PASSWORD`).
Every note the case writes starts with `QA J01 `. Delete the persona's leftover notes so it starts with 0 notes.

## Test Steps

### 1. R1-001 Add a note: it appears at the top of the list
As MEMBER, type `  QA J01 first  ` and press Add note, then `QA J01 second`.
**Verify:** the list reads `QA J01 second`, `QA J01 first` in this order (trimmed), and an 80-character title is saved whole.
**Oracle:** the titles typed by the test (independent of the app), trimmed by the test; every row of the list is compared, with the total asserted. Negative proof: the order `first, second` must fail.
Screenshot: qa/evidence/cases/J01-notes-basics/01.png (viewport 390x844 dpr 2)
Design contract: notes-home#addNote

### 2. R1-002 Invalid titles are refused and nothing is saved
As MEMBER, submit an empty title, a title of spaces and a title of 81 characters.
**Verify:** each shows `Title must be 1-80 characters`; the count stays `0 notes` and the list is empty.
**Oracle:** the message text of docs/SPEC.md 1.2 (not the code constant); the API list re-read after the three attempts has 0 rows.

### 3. R1-003 The count label follows the number of notes
As MEMBER, from 0 notes add one note, then a second one.
**Verify:** the label reads `0 notes`, `1 note`, `2 notes`.
**Oracle:** the label computed by the test from the number of rows of the API list (separate formula), on each step.
Design contract: notes-home#count

### 4. R1-004 Delete one of my notes
As MEMBER with two notes, press Delete next to `QA J01 delete-me`.
**Verify:** that row leaves the list, the other one stays, the count goes from `2 notes` to `1 note`.
**Oracle:** the API list after the delete has exactly the surviving id. Negative proof: the deleted id must not come back after a reload.

### 5. R1-005 A member sees only their own notes
MEMBER adds `QA J01 private`; MEMBER_B opens the home page.
**Verify:** MEMBER_B's list does not contain `QA J01 private` and their count is `0 notes`.
**Oracle:** every row of MEMBER_B's API list belongs to MEMBER_B (all rows, total asserted). Positive control: MEMBER still sees the note.

### 6. R3-001 Header of the spec
Open the home page signed out and signed in.
**Verify:** heading `Tiny Notes`, 24 px, weight 700, white on `#0b5cad`.
**Oracle:** the values of docs/SPEC.md 3.1 in tokens.json, compared with the computed styles at 390x844 dpr 2 and at desktop.
Design contract: notes-home#header, notes-home#headerBar

### 7. R3-002 Every button is at least 44 x 44 px
Signed in with two notes, and signed out.
**Verify:** every visible button (Sign in, Add note, each Delete) measures at least 44 x 44 CSS px.
**Oracle:** the bounding box of EVERY button on the page, with the number of buttons asserted. Negative proof: a threshold above the real size must fail.
Design contract: notes-home#signIn, notes-home#addNote

### 8. R3-003 Text contrast is at least 4.5:1
Signed in.
**Verify:** the user name, the count and the button labels have a contrast of at least 4.5:1 against their background.
**Oracle:** WCAG relative luminance computed from the rendered colours (design-contract `contrastMin`).
Design contract: notes-home#who, notes-home#count, notes-home#addNote

## After Hook

### Teardown 1. Idempotent cleanup
Delete every note of MEMBER and MEMBER_B whose title starts with `QA J01 `; a second run matches nothing.
