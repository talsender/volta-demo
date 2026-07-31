# Practical call-flow redesign — Design

**Date:** 2026-07-13
**Trigger:** Stakeholders liked the demo's look but flagged the real problem: the system doesn't shorten the sales call or lower agent-handling cost. Too many clicks, and reps over-engage with the interactive 3D house editor instead of closing the call fast.

## Goal

Redesign the live-call path (settlement check → roof wizard → outcome) to be as fast and low-friction as possible, while keeping the powerful tools (detailed 3D planning, knowledge base, pricing) available to the right person at the right time — just not competing for the rep's attention mid-call.

## North star framing

Two zones, not seven equal tabs:
- **Live call** (settlement check, roof wizard, outcome with inline pricing): must be brutally fast.
- **Everything else** (knowledge base / offerings as standalone browsing, full 3D planning, attendance, manager admin): valuable, but not mid-call.

## Confirmed facts from the codebase (grounding the design)

- Pricing already surfaces inline in the wizard result via `Offerings.matchForRoof` ([app.js:657](../../../app.js#L657)) — no gap there.
- Switching tabs does not reset wizard state (`initTabs` only toggles `.hidden`, [app.js:8-23](../../../app.js#L8-L23)) — the cost of a tab detour is navigation time, not data loss.
- The full 3D/2D editor entry button `#se-open-btn` ("⛶ הגדל ועריכה") is rendered in the sim-dock header and is clickable from the very first moment the wizard renders — **not** gated to the end of the flow ([sim-editor.js:325-349](../../../sim-editor.js#L325-L349), [index.html:273](../../../index.html#L273)). This is the concrete mechanism behind "reps play with the 3D too much."
- `Requests.buildRequest({ type, agent, subject, reason, context, requestedStatus })` ([requests.js:30](../../../requests.js#L30)) already supports a `type` field, currently `'settlement'` | `'roof'`, with type-specific handling in `admin.js` (~332-347, 364-383) and `app.js` (~1060-1063). A third type slots in additively.
- `Wizard`'s internal state (`wizard.js:66-77`) has `step`, `answers`, `flags`, `outcome`, etc. — no timing fields yet.
- `VoltaDB.addAuditEvent` / `subscribeAuditLogs` already exist and back the manager panel's Audit tab ([firebase.js](../../../firebase.js), `admin.js` audit rendering) — a generic event log, reusable for call-duration events.

## Scope

### 1. Merge the 5 eligibility gates into one checklist screen
`property-type`, `ownership`, `permit`, `connection`, `meter` (today: 5 sequential full-screen taps, `wizard.js:225` `MAIN_FLOW`) become one screen with 5 toggles + a single "המשך" submit.

Evaluation on submit, preserving today's exact qualification semantics:
1. Walk the 5 answers in the existing order.
2. If any answer's `action === 'stop'` — the outcome stops immediately, using **the first stop encountered in order** for `stopReason`/`stopScript` (matches today's behavior where an earlier disqualifying answer is what the rep would have hit first).
3. Otherwise, accumulate **all** `flag` and `follow-up` messages from all 5 answers (not just one) into `state.flags` / follow-up notes, and advance to the next step.
4. Each of the 5 sub-answers is still pushed onto `state.answers` individually, so the "previous answers" recap trail shows all five distinctly, unchanged from today.
5. Back-button (`Wizard.back()`) snapshots the whole checklist as one undo step, same snapshot-based mechanism already in place.

No change to per-question copy, stop reasons, or flag messages — only how many screens it takes to answer them.

### 2. Visible step + elapsed-time indicator
`Wizard.reset()` records `state.startedAt = Date.now()`. The wizard progress header gains a live-updating elapsed-time chip next to the existing "שאלה X מתוך Y" counter (same `setInterval`-tick pattern already used for the header clock). Not a restriction — just makes pace visible to the rep so it self-regulates.

### 3. Merge "roof type" with "material size" into one screen
Today: pick roof type(s) → confirm → separate screen to enter size per type (`roof-type` + `material-sizes` as two `MAIN_FLOW` entries). Becomes one screen: toggling a roof type immediately reveals its size input inline. `Wizard.confirmRoofTypes` + `Wizard.answerMaterialSizes` merge into one `Wizard.confirmRoofTypesAndSizes(sizesMap)` call.

### 4. "Detailed planning" permission gate on the full 3D/2D editor
- New capability in `Auth.CAPS` ([auth.js:14](../../../auth.js#L14)): `detailedPlanning`. Role defaults: `manager: true`, `lead: false`, `agent: false`.
- New optional per-agent field `canDetailedPlan` (boolean) on the agent record. When present, it overrides the role default (`true`/`false` wins over the role's default; `undefined` falls through to the role default). Editable via a checkbox in the agent add/edit form in `admin.js`, next to the existing role selector — the manager can grant or revoke it per individual agent regardless of role, per the earlier decision ("המנהל מחליט לפי נציג/הרשאה").
- `#se-open-btn` is hidden by default and shown only when **both**: the wizard has reached an outcome (`Wizard.getState().outcome` is set) **and** `Auth.can(currentAgent, 'detailedPlanning')` is true.
- When the outcome is reached and the current agent lacks the permission, a "📤 שלח לתכנון טכני" button renders in its place. It calls `Requests.buildRequest({ type: 'planning', ... })` — a third request type alongside `'settlement'`/`'roof'`, reusing the existing request pipeline (manager sees it in the same requests review tab; no new backend collection, no "permanent approval" branch since that concept doesn't apply to a planning handoff — the existing `type === 'roof'`/`'settlement'` guards in `admin.js` simply won't fire for it, so it falls through to a plain approve/deny decision).

### 5. Contextual reference drawer inside the wizard
A collapsible drawer reachable from the wizard screen itself (not a tab switch) surfaces the existing knowledge-base and offerings data (`knowledge-base.js`, `offerings.js` — unchanged), highlighting the entry relevant to the rep's current selection (e.g., selecting the "pergola" roof type auto-surfaces the pergola KB note and its pricing at the top of the drawer). The standalone "מאגר ידע" / "מסלולים ומחירים" tabs (03/04) are **not removed** — they remain for out-of-call browsing/prep. This is additive.

### 6. Call-duration measurement
On `Wizard.reset()` and on reaching an outcome, the app logs a `wizard-duration` event via the existing `VoltaDB.addAuditEvent` (`{ agentId, durationMs, outcome }`). A small pure aggregation function computes count/median/average from the existing audit-log stream; its output is surfaced as a stat block inside the manager panel's existing Audit tab (no new tab). This closes the loop: without measuring actual call duration, there's no way to confirm the redesign met the goal it was built for — that was the original complaint.

## Explicitly out of scope (considered, rejected)

- **Smart context defaults** (pre-filling ownership/property-type) — rejected: risk of a rep rubber-stamping a legally-relevant gate (e.g., rental mis-marked as owned) outweighs the time saved.
- **Role-gating the knowledge base / offerings tabs** — no evidence reps waste time there; the complaint was specifically about the 3D editor.
- **Keyboard shortcuts (1/2/3 for options)** — real but marginal benefit vs. effort; deferred.
- **Real calendar/scheduling integration** — no backend for it exists; out of scope for this demo.

## Testing & verification

- Unit tests (pure logic, `node --test`): merged eligibility-checklist evaluation (stop precedence, flag accumulation, back-button snapshot); merged roof-type+size confirm; `Auth.can` with the new capability and per-agent override (both directions: override true when role default false, override false when role default true); the duration-aggregation function (count/median/average, empty-input handling).
- Browser e2e (headless Chrome, as used throughout this project): `#se-open-btn` is absent before the wizard reaches an outcome; absent at outcome for an agent without the permission (shows the handoff button instead); present at outcome for an agent with the permission (role default or per-agent override); the checklist screen stops correctly on a disqualifying toggle and shows accumulated flags when none disqualify; the reference drawer surfaces the right KB/offering entry for a selected roof type; the elapsed-time chip ticks.
- Manual smoke check against the live deployed site (read-only for the shared Firestore, per existing project convention) before calling it done.
