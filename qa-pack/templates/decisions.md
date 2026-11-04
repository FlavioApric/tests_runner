# Decisions register

One row per open question (a DIVERGENT or SPEC-CONFLICT requirement, an @owner-decision step). Status: `open` or `decided`. A decided row says what was chosen (`fix app` or `change spec`) and the date. `pack decisions --check` (gate G1) fails while any row is `open`.

| Key | Where | What is open | Status | Decision | Date |
|---|---|---|---|---|---|
