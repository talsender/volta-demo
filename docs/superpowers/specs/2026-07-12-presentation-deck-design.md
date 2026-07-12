# VOLTA system presentation deck — Design

**Date:** 2026-07-12
**Deliverable:** A self-contained Hebrew RTL HTML slide deck, published as a private Artifact link, presenting the live system to the team.

## Goal

An inspiring, "mission-control"-styled deck that shows the system is real, live, and built with serious investment — and that it supports the sales team day-to-day.

## Key messages (user-mandated)

1. **The system is live, running on synthetic demo data only.** No real city/settlement data was used; it awaits the official settlements dataset — a dedicated slide plus a badge on the title slide.
2. Working product, not promises — real screenshots from the live site, real project numbers.
3. Playful touch: the staged attendance-board screenshot includes a row for **קורן** clocking in late, with a wink (client-side staging only; nothing written to the DB).

## Structure (~12 slides)

1. Title — VOLTA · מערכת הנציגים + "live · synthetic data" badge
2. The problem — a rep on a call needs answers in seconds
3. The solution — one screen, all the answers (module map)
4. Module 01 — settlement check + live globe (screenshot)
5. Module 02 — roof qualification wizard, 14 materials, back-one-step (screenshot)
6. 3D home simulation + plan editor — snap, obstacles, per-segment heights (screenshot)
7. Modules 03/04 — knowledge base + offerings & pricing (screenshots)
8. Module 05 — attendance time-clock, live board, manager report (staged screenshot incl. Koren 😉)
9. Manager panel — exception requests, agents, audit (screenshot)
10. **Live but clean** — deployed and working; all settlement data is synthetic demo data; waiting for the real dataset to plug in
11. Under the hood — numbers: 7 modules, 32 tests, live Firestore sync, security hardening
12. Closing — the link; "כבר באוויר"

## Implementation

- Single HTML file (deck + inline CSS/JS), Hebrew RTL, dark brand aesthetic matching the app (space background, sun-core motif, brand accent colors), big type.
- Navigation: arrow keys / click / swipe / progress dots; fullscreen-friendly for projection.
- Screenshots captured from the live site with headless Chrome (read-only; logged-in state via injected session), embedded as JPEG data URIs — the artifact CSP allows `data:` images only.
- Published via the Artifact tool (private link, favicon ☀️).

## Verification

Render the HTML locally in headless Chrome before publishing: all slides navigate, images load, no console errors; then publish and share the link.
