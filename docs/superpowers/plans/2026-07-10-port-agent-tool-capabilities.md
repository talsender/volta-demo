# Port Source-Project Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port three capabilities from the internal `volta-agent-tool` repo (attendance time-clock, wizard back button, house-editor upgrades) into `volta-demo` without disturbing demo-specific changes.

**Architecture:** File-level port. Demo feature files are byte-identical to the source at scaffold base `f291ac7`, so untouched-in-demo files are copied wholesale from source HEAD; the four demo-diverged files (`app.js`, `index.html`, `firebase.js`, `styles.css`) receive only the feature commits' hunks via `git apply` of cross-repo patches (context lines verified disjoint from demo divergence).

**Tech Stack:** Vanilla JS (browser globals pattern), Firestore via `VoltaDB` facade, `node --test`, headless Chrome (puppeteer-core) for e2e, GitHub Pages deploy.

## Global Constraints

- Source repo: the internal `volta-agent-tool` working copy (referred to as `$SRC`), at HEAD `a63fbc2`.
- Do NOT port source commits `2ff6cc9` (clock), `a629003`/`a63fbc2` (auth fixes — demo has stronger fix from 2026-07-10), `ce5125e` (header restyle), `49add2d` (Firebase Hosting deploy flag).
- Do NOT touch demo-specific code: Hebrew telemetry header, Israel clock, `startAgentAuthSession()` / `meta.authoritative` auth-race fix.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All shell commands below are Git Bash syntax, run from the demo repo root; `SRC` points at the source working copy.

---

### Task 1: Editor upgrades (snap, auto-arrange, obstacles, segment levels)

**Files:**
- Create: `tests/roof-layout.test.js` (copy from `$SRC/tests/roof-layout.test.js`)
- Modify (wholesale copy from `$SRC` HEAD): `roof-layout.js`, `plan-editor.js`, `sim-editor.js`, `sim.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RoofLayout.snapMove(house, idx, x, y)`, `RoofLayout.autoArrange(house)`, `RoofLayout.segmentHeight(house, seg)` — used internally by `plan-editor.js`/`sim.js`; obstacle objects gain physical size `o.s`; segments gain level `h`.

- [x] **Step 1: Copy the test file (failing test)**

```bash
cp "$SRC/tests/roof-layout.test.js" tests/roof-layout.test.js
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test tests/roof-layout.test.js`
Expected: FAIL — demo `roof-layout.js` lacks `snapMove`/`autoArrange`/`segmentHeight`.

- [x] **Step 3: Copy the four implementation files**

```bash
cp "$SRC/roof-layout.js" "$SRC/plan-editor.js" "$SRC/sim-editor.js" "$SRC/sim.js" .
```

- [x] **Step 4: Verify tests pass and no demo divergence was lost**

Run: `node --test tests/roof-layout.test.js` → PASS.
Run: `for f in roof-layout.js plan-editor.js sim-editor.js sim.js; do diff <(tr -d '\r' < $f) <(tr -d '\r' < "$SRC/$f") && echo "$f OK"; done` → all OK (files now identical to source HEAD).

- [x] **Step 5: Commit**

```bash
git add roof-layout.js plan-editor.js sim-editor.js sim.js tests/roof-layout.test.js
git commit -m "feat(editor): snap + auto-arrange, physical obstacles, per-segment levels (ported)"
```

---

### Task 2: Wizard back-one-step button

**Files:**
- Modify (wholesale copy): `wizard.js` (source diff vs demo = the back feature only, 22 lines)
- Modify (patch): `app.js` — hunks from source commit `7cd6069` only

**Interfaces:**
- Consumes: `Wizard.back()`, `Wizard.canBack()` (added by the wizard.js copy).
- Produces: `wizardBack()` in app.js + `data-app-action="wizard-back"` buttons. Task 3's app.js patch expects `function wizardBack()` to exist (its context anchor).

- [x] **Step 1: Copy wizard.js**

```bash
cp "$SRC/wizard.js" wizard.js
```

- [x] **Step 2: Apply the app.js hunks from `7cd6069`**

```bash
git -C "$SRC" show 7cd6069 -- app.js > /tmp/wizard-back.patch
git apply --verbose /tmp/wizard-back.patch
```

Adds: `wizard-back` branch in `initAppDelegates`, `wizardBack()` helper after `resetWizard()`, and a `→ חזור שלב` button in `renderWizard()` + each result screen. If `git apply` rejects a hunk, apply it manually from the patch text (contexts verified present in demo).

- [x] **Step 3: Verify existing tests still pass; syntax check**

Run: `npm test` → all PASS. Run: `node --check app.js && node --check wizard.js` → no output.

- [x] **Step 4: Commit**

```bash
git add wizard.js app.js
git commit -m "feat(wizard): back-one-step button — snapshot-based undo (ported)"
```

---

### Task 3: Attendance time-clock

**Files:**
- Create: `attendance.js`, `tests/attendance.test.js` (copies)
- Modify (wholesale copy): `admin.js` (source diff vs demo = attendance manager tab only, 117 lines)
- Modify (patch, hunks from source commit `cfdfd00` only): `firebase.js`, `index.html`, `app.js`, `styles.css`

**Interfaces:**
- Consumes: `VoltaDB.ready()`, `Auth.getCurrentAgent()`, `escHtml()` (already in demo).
- Produces: `Attendance.localDateKey/docId/applyPunch/computeSummary/fmtTime/fmtDur/toCsv`; `VoltaDB.subscribeAttendanceForDate/getAttendanceEntry/setAttendanceEntry/getAttendanceRange`; app functions `initAttendance/attendancePunch/renderAttendance`; new Firestore collection `attendance` (doc id `YYYY-MM-DD_agentId`).

- [x] **Step 1: Copy the pure module's test file (failing test)**

```bash
cp "$SRC/tests/attendance.test.js" tests/attendance.test.js
```

Run: `node --test tests/attendance.test.js` → FAIL (`Cannot find module '../attendance.js'`).

- [x] **Step 2: Copy attendance.js, verify tests pass**

```bash
cp "$SRC/attendance.js" attendance.js
node --test tests/attendance.test.js
```

Expected: PASS (12 tests).

- [x] **Step 3: Copy admin.js (manager report tab)**

```bash
cp "$SRC/admin.js" admin.js
```

- [x] **Step 4: Apply the `cfdfd00` hunks to the four diverged files**

```bash
for f in firebase.js index.html app.js styles.css; do
  git -C "$SRC" show cfdfd00 -- "$f" > "/tmp/att-$f.patch"
  git apply --verbose "/tmp/att-$f.patch"
done
```

This adds: attendance data-layer functions + export line in `firebase.js`; tab `05 ⏱ נוכחות` button, `#tab-attendance` section, admin `נוכחות` tab button + `#admin-attendance` pane, and `<script src="attendance.js">` in `index.html`; `attendance-punch` delegate, attendance block (`initAttendance`…`renderAttendance`), `renderAttendance()` call in `renderAgentBar`, `initAttendance()` in `init()` in `app.js`; `.att-*` styles in `styles.css`. If a hunk rejects, apply manually — demo divergence (header, auth fix) does not overlap these contexts.

- [x] **Step 5: Verify full suite + syntax**

Run: `npm test` → all PASS. Run: `node --check app.js && node --check firebase.js && node --check admin.js && node --check attendance.js` → no output.

- [x] **Step 6: Commit**

```bash
git add attendance.js tests/attendance.test.js admin.js firebase.js index.html app.js styles.css
git commit -m "feat: attendance time-clock — punch in/out, live daily board, manager report (ported)"
```

---

### Task 4: Full verification

**Files:**
- Use: `tools/verify-clean.sh` (proprietary-token sweep), scratchpad browser script.

- [x] **Step 1: Run the repo's proprietary-token sweep**

Run: `bash tools/verify-clean.sh` → expected: clean / exit 0. (Note: the sweep must exclude itself — its pattern line contains the tokens it hunts.)

- [x] **Step 2: Browser e2e (headless Chrome, local serve)**

Serve: `npx http-server . -p 8123 -c-1 --silent` (background). Script checks, with a probe agent session (created as a real Firestore agent doc for the test, removed afterwards):
1. Tab `⏱ נוכחות` exists; clicking it shows the punch button enabled.
2. Click punch → button flips to `⏹ החתם יציאה`, board shows one row; click again → flips back to `▶ החתם כניסה`, row shows totals.
3. Wizard tab: answer one question → `→ חזור שלב` button appears; click → previous question restored.
4. Sim editor opens (enlarge & edit) with snap toggle + auto-arrange buttons; no `pageerror` in console.

- [x] **Step 3: Clean up probe data**

Delete the probe's attendance doc and the probe agent doc via Firestore REST:
`curl -X DELETE "https://firestore.googleapis.com/v1/projects/volta-demo-92912/databases/(default)/documents/attendance/<todayKey>_<probeId>"`
`curl -X DELETE "https://firestore.googleapis.com/v1/projects/volta-demo-92912/databases/(default)/documents/agents/<probeId>"`

- [x] **Step 4: Commit any fixes found**

Only if e2e surfaced issues; otherwise nothing to commit.

---

### Task 5: Deploy + live verification

- [x] **Step 1: Push**

```bash
git push origin main
```

- [x] **Step 2: Poll Pages until deployed**

Run: poll `https://talsender.github.io/volta-demo/attendance.js` (nocache query) until HTTP 200, up to ~4 min.

- [x] **Step 3: Live browser check (read-only)**

Same script against `https://talsender.github.io/volta-demo/`: attendance tab renders, punch button reflects login state, wizard back button appears mid-wizard, editor opens without console errors. No punch clicks against the live board (avoid polluting real data).
