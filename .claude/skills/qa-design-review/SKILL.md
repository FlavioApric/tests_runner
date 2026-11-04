---
name: qa-design-review
description: Review QA screenshots of a qa-pack project against the design contract and the spec like a real user would (cut-off text, alignment, contrast, blurry images, wrong link). Use after a run that produced screenshots, or before the owner approves golden images.
---

# /qa-design-review

Inputs: a screenshot, the contract keys of its step (`<paths.contracts>/<screen>.json`), the tokens
(`<paths.contracts>/tokens.json`, light and dark), the spec section. Look at the image at its real size, at mobile
390x844 dpr 2 and at desktop. Check: text cut off or overlapping, alignment and spacing, contrast, image sharpness and
aspect, placeholders, wrong language or raw keys, links and their target. Output a table key / expected / seen /
verdict, plus anything the contract does not cover (propose a new key). Never promote golden images yourself: the
owner approves candidates (`paths.candidates` -> `paths.golden`) and signs `design-approved.md`.
