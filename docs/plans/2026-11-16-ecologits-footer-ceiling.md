# EcoLogits Footer Ceiling Gauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour the ecologits footer segment green→red by progress toward per-session ceilings, and append `‼` once a ceiling is reached.

**Architecture:** Pure helpers in `index.ts` (`ceilingProgress`, `gaugeColor`) plus an `overCeiling` flag on `formatFooter`; `refresh` wraps the text with `ctx.ui.theme.style` when a theme exists.

**Tech Stack:** TypeScript run by pi; tests with `node --test` (Node 26 type stripping).

**Spec:** `~/.pi/agent/extensions/ecologits/docs/specs/2026-11-16-ecologits-footer-ceiling-design.md`

## Global Constraints
- Directory: `~/.pi/agent/extensions/ecologits/`; no npm runtime dependencies; only type imports from pi packages.
- Ceilings: `CEILING = { energyKWh: 0.05, gwpKg: 0.02, waterL: 0.2 }`.
- Marker: ` ‼` (space + U+203C), always last on the line.
- Hue: `120 * (1 - p)` degrees, `p` clamped to [0, 1].
- No first-person pronouns in comments or user-facing text.

## Review Focus
- Ceiling exactly reached (`p === 1`) → red and `‼` (test: boundary in Task 1).
- Totals far above ceiling → hue stays 0, not negative (test: clamp in Task 1).
- `n/a (model)` shown while over ceiling → `‼` after the n/a note (test in Task 1).
- No theme on `ctx.ui` (print/RPC/test mocks) → plain text, no crash (existing tests keep passing).
- Only unknown models (`anyKnown` false) → no `‼`, no colour (test in Task 1).

---

### Task 1: Ceiling gauge in footer

**Files:**
- Modify: `index.ts` (formatting helpers ~L60–97, `refresh` ~L142–147)
- Test: `index.test.ts`

**Interfaces:**
- Produces: `export const CEILING`, `export function ceilingProgress(t: Impacts): number`, `export function gaugeColor(p: number, appearance?: "dark" | "light"): { kind: "rgb"; r: number; g: number; b: number }`, `formatFooter(total, unknownCurrent?, anyKnown = true)` now appends ` ‼` when `anyKnown && ceilingProgress(total) >= 1`.

- [ ] **Step 1: Write failing tests** in `index.test.ts`:
  - `ceilingProgress` returns 0 for zero impacts, 0.5 when energy midpoint is 0.025 kWh and others are lower, 1 when gwp midpoint is 0.04 kg (clamped).
  - `gaugeColor(0)` is green-dominant (`g > r`, `b` lowest); `gaugeColor(1)` is red-dominant (`r > g`); `gaugeColor(0.5)` has `r ≈ g` (yellow); `gaugeColor(2)` equals `gaugeColor(1)`.
  - `formatFooter` with energy midpoint exactly 0.05 kWh ends with ` ‼`; with 0.01 kWh does not contain `‼`; with over-ceiling totals and `unknownCurrent = "x"` ends with `n/a (x) ‼`; with `anyKnown=false` contains no `‼`.
  - With `ctx.ui.theme = { appearance: "dark", style: (t, o) => \`<${o.fg.kind}>${t}\` }`, the status after a `message_end` starts with `<rgb>`.
- [ ] **Step 2:** Run `node --test` in the extension dir; expect the new tests to FAIL (missing exports).
- [ ] **Step 3: Implement.** HSV→RGB with saturation 0.85, value 0.95 (dark) / 0.70 (light), default dark. In `refresh`, if `ctx.ui.theme?.style` exists and `anyKnown`, wrap the footer text: `theme.style(text, { fg: gaugeColor(ceilingProgress(total), theme.appearance) })`. Update the file header comment to cite the new spec.
- [ ] **Step 4:** Run `node --test`; expect all tests PASS (existing `FOOTER` regex still matches because the mock has no theme and totals are under the ceiling).
- [ ] **Step 5:** No git repo in `~/.pi/agent`; record completion in `2026-11-16-ecologits-footer-ceiling.progress.md` instead of committing.
