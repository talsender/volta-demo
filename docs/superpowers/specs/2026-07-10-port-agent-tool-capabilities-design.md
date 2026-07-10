# Port source-project capabilities to volta-demo — Design

**Date:** 2026-07-10
**Source:** the internal `volta-agent-tool` repo, commits after the demo scaffold point (`f291ac7`, 2026-07-02).
**Target:** `volta-demo` (this repo, deployed to GitHub Pages).

## Goal

Bring the three capabilities added to the source project after volta-demo was scaffolded, without disturbing demo-specific work (Hebrew telemetry header, Israel clock, the 2026-07-10 auth-race fix).

## Capabilities to port

### 1. Attendance time-clock (`cfdfd00`)
- Punch in / punch out button in the agent bar; state persists per agent per day.
- Live daily board: who is currently punched in, first-in / last-out times.
- Manager report tab in the admin panel: per-agent daily totals.
- New `attendance.js` module (pure logic: day keys, session pairing, totals) + `tests/attendance.test.js`.
- New Firestore collection `attendance` accessed via new `VoltaDB` functions.
- **Not ported:** `firestore.rules` hunk — the demo Firestore project runs open rules; noted as a production gap, acceptable for the demo.

### 2. Wizard back-one-step button (`7cd6069`)
- "Back" button in the roof qualification wizard; restores the previous question without losing accumulated answers/notes.
- Touches `wizard.js` (state history) and `app.js` (render + click wiring).

### 3. House/plan editor upgrades (`f0a06db`…`26f319d`)
- Magnetic snap on drag with guide lines + snap on/off toggle.
- Auto-arrange button (pure `autoArrange` in the layout model).
- Physical-size obstacles: all 5 types addable, resize handle in 2D, scale in 3D; obstacles ride their module's level.
- Per-segment height (level) slider; 3D modules render at their own level and shade panels accordingly.
- Touches `roof-layout.js`, `plan-editor.js`, `sim-editor.js`, `sim.js` + adds `tests/roof-layout.test.js` (missing from the demo scaffold).

## Port mechanism

Verified: every feature file in the demo is byte-identical to the source at the scaffold base `f291ac7`, so:

- **Wholesale copy from source HEAD** (diff vs demo = features only): `roof-layout.js`, `plan-editor.js`, `sim-editor.js`, `sim.js`, `wizard.js`, `admin.js`, `attendance.js` (new), `tests/attendance.test.js` (new), `tests/roof-layout.test.js` (new).
- **Targeted hunks only** (files where the demo diverged — Hebrew header, demo config, auth-race fix): `app.js` (attendance wiring + wizard back button), `index.html` (attendance markup), `firebase.js` (attendance data-layer functions), `styles.css` (attendance styles).

## Deliberately skipped source commits

| Commit | Why skipped |
|---|---|
| `2ff6cc9` clock fix | Demo already has its own Israel-clock implementation (`c8c8c43`). |
| `a629003`, `a63fbc2` auth/flicker fixes | Demo received a stronger fix on 2026-07-10 (subscription started only after `VoltaDB.init()` + non-authoritative snapshot tagging). |
| `ce5125e` header one-line restyle | Style-only; assumes the source header markup, demo header diverged. |
| `49add2d` deploy escape hatch | Firebase-Hosting-specific; demo deploys via GitHub Pages. |

## Integration points to watch

- `firebase.js`: the demo version now tags agent-list updates with `meta.authoritative`; the attendance functions are additive and must merge alongside, not replace.
- `admin.js` wholesale copy brings the attendance report tab; its diff vs demo is exactly the attendance commit (verified: 117 lines).
- The attendance UI strings are Hebrew and generic — no proprietary data. Sweep the ported code for proprietary tokens before committing (same bar as the original scaffold scrub).

## Error handling

- Attendance writes go through `VoltaDB` with the same best-effort pattern as the rest of the app (UI never blocks on Firestore failure).
- Editor features are pure-model + canvas; failures stay local to the editor modal.

## Testing & verification

1. `npm test` — existing suite + the two ported test files must pass.
2. Headless-Chrome verification against a local serve: punch in → appears on daily board → punch out; wizard back button restores the previous step; editor opens with snap/auto-arrange/obstacle controls and no console errors.
3. Deploy to GitHub Pages, re-run the browser checks against the live site.
