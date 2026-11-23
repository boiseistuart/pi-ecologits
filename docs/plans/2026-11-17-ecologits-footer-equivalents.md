# EcoLogits footer equivalents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an everyday equivalent after each footer number (` ≈ 📱 0.92 charges` and so on), in a softer tone of the gauge hue.

**Architecture:** `footerSegments()` returns the footer as `{ text, tone }` pieces. `formatFooter()` joins them into the plain string, and `refresh()` styles each piece: `"main"` with `gaugeColor`, `"soft"` with a new `softGaugeColor`.

**Tech Stack:** TypeScript run by pi; tests with `node --test` (Node 26 type stripping), no npm deps.

**Spec:** `~/.pi/agent/extensions/ecologits/docs/specs/2026-11-17-ecologits-footer-equivalents-design.md`

## Global Constraints

- Factors: 13 Wh per charge, 240 gCO₂e per mile, 200 mL per glass. Computed from the same midpoints the footer shows.
- Separator ` ≈ `. Emoji 📱 🚗 🥛. Units always plural: `charges`, `miles`, `glasses`.
- Numbers formatted with the existing `num()`.
- `‼` stays last, in the gauge colour.
- `anyKnown` false: no equivalents, no colour, no `‼`.
- Colours are literal `{ kind: "rgb", r, g, b }` passed to `theme.style()`. Skip colour when the theme or `style` is missing.
- No first-person pronouns in comments or commit messages.

## Review Focus

1. Very small sessions: equivalents go through `num()`, so tiny values show as e.g. `7.7e-5 charges`. This matches the footer's existing style and is accepted.
2. Large totals where the footer switches to kWh/kg/L: the equivalents still use base values, so `~1.2 kWh ≈ 📱 92 charges`. Test in Task 1.
3. Unknown current model after known ones: `n/a (model)` comes after the last equivalent, then `‼`. Test in Task 1.
4. Light theme: the soft tone must be closer to the background (lighter), not darker. Test in Task 1.
5. No theme: the status must equal the `formatFooter()` string exactly. Test in Task 1.

---

### Task 0: Commit pending ceiling-gauge work

- [ ] **Step 1:** In `~/.pi/agent/extensions/ecologits`, run `node --test`. Expect all to pass.
- [ ] **Step 2:** `git add index.ts index.test.ts && git commit -m "feat: colour footer by per-session ceiling progress"`

### Task 1: Equivalents and soft tone

**Files:**
- Modify: `~/.pi/agent/extensions/ecologits/index.ts` (constants near `CEILING`; `formatFooter`; `refresh`)
- Test: `~/.pi/agent/extensions/ecologits/index.test.ts`

**Interfaces:**
- Produces:
  - `export const EQUIV = { whPerCharge: 13, gPerMile: 240, mlPerGlass: 200 }`
  - `export type FooterSegment = { text: string; tone: "main" | "soft" }`
  - `export function footerSegments(total: Impacts, unknownCurrent?: string, anyKnown = true): FooterSegment[]`
  - `formatFooter` keeps its signature and returns `footerSegments(...).map(s => s.text).join("")`
  - `export function softGaugeColor(p: number, appearance: "dark" | "light" = "dark"): { kind: "rgb"; r: number; g: number; b: number }`: same hue as `gaugeColor(p)`, lower saturation. On dark themes it has lower brightness than `gaugeColor`. On light themes it has higher brightness. Exact amounts are the builder's call; start with s≈0.45, v≈0.65 (dark) / 0.85 (light).

- [ ] **Step 1: Write the failing tests** (in `index.test.ts`, after the ceiling tests; update the imports)

```ts
// Change the existing FOOTER constant to:
const FOOTER = /^⚡ ~.* Wh ≈ 📱 .* charges · ~.* gCO₂e ≈ 🚗 .* miles · ~.* mL ≈ 🥛 .* glasses$/;

test("formatFooter shows equivalents beside each value", () => {
	assert.equal(
		formatFooter(totals(0.012, 0.0051, 0.048)),
		"⚡ ~12 Wh ≈ 📱 0.92 charges · ~5.1 gCO₂e ≈ 🚗 0.021 miles · ~48 mL ≈ 🥛 0.24 glasses",
	);
	assert.match(formatFooter(totals(1.2, 0.001, 0.001)), /~1\.2 kWh ≈ 📱 92 charges/);
	assert.match(formatFooter(totals(0.1, 0.1, 1), "x"), /🥛 5 glasses · n\/a \(x\) ‼$/);
	assert.doesNotMatch(formatFooter(totals(0.1, 0.1, 1), "x", false), /≈/);
});

test("footerSegments marks equivalents soft and the rest main", () => {
	const segs = footerSegments(totals(0.05, 0.001, 0.01));
	assert.deepEqual(segs.filter((s) => s.tone === "soft").map((s) => s.text.split(" ")[2]), ["📱", "🚗", "🥛"]);
	assert.ok(segs.filter((s) => s.tone === "soft").every((s) => s.text.startsWith(" ≈ ")));
	assert.deepEqual(segs.at(-1), { text: " ‼", tone: "main" });
});

test("softGaugeColor keeps the hue but stands out less", () => {
	for (const p of [0, 0.5, 1]) {
		const main = gaugeColor(p), soft = softGaugeColor(p);
		const order = (c: any) => ["r", "g", "b"].sort((a, b) => c[b] - c[a]).join("");
		assert.equal(order(soft), order(main), `same hue at p=${p}`);
		assert.ok(Math.max(soft.r, soft.g, soft.b) < Math.max(main.r, main.g, main.b), "dimmer on dark");
		const lm = gaugeColor(p, "light"), ls = softGaugeColor(p, "light");
		assert.ok(Math.min(ls.r, ls.g, ls.b) > Math.min(lm.r, lm.g, lm.b), "paler on light");
	}
});

test("refresh styles soft segments with the soft colour", async () => {
	const s = setup();
	const styled: { t: string; fg: any }[] = [];
	(s.ctx.ui as any).theme = { appearance: "dark", style: (t: string, o: any) => (styled.push({ t, fg: o.fg }), t) };
	await s.handlers.message_end(assistant("claude-opus-5-5", 500), s.ctx);
	const soft = styled.filter((x) => x.t.startsWith(" ≈ "));
	assert.equal(soft.length, 3);
	const main = styled.find((x) => x.t.startsWith("⚡"))!;
	assert.notDeepEqual(soft[0].fg, main.fg);
	assert.match(s.statuses.at(-1)!, FOOTER); // the mock style is the identity, so the joined text is the plain footer
});
```

Two existing tests also need updating:
- In "footer is coloured through the theme when one exists", the assertion `/^<rgb>⚡ /` still holds. Keep it.
- In "only unknown models", nothing changes.

- [ ] **Step 2:** Run `node --test`. Expect the new tests to FAIL (missing exports `footerSegments`, `softGaugeColor`).
- [ ] **Step 3: Implement**
  - Add `EQUIV`, `FooterSegment`, `footerSegments`, `softGaugeColor` in `index.ts`.
  - Factor the HSV→RGB in `gaugeColor` into a shared helper taking `(h, s, v)`.
  - Segment layout when `anyKnown`: the main segment holds `⚡ ` plus the energy value. Then a soft segment ` ≈ 📱 <num(mid(energy)*1000/13)> charges`. Then a main segment ` · ` plus the next value, and so on.
  - The `n/a (model)` part is main, joined with ` · `, and `‼` is the last main segment.
  - In `refresh`, when theme `style` exists and `anyKnown`, map each segment to `theme.style(text, { fg: tone === "soft" ? softGaugeColor(p, app) : gaugeColor(p, app) })` and join. Otherwise use `formatFooter(...)`.
- [ ] **Step 4:** Run `node --test`. Expect all PASS. Also run `node --test` across the whole directory (llm, lookup) to confirm no regressions.
- [ ] **Step 5:** `git add index.ts index.test.ts && git commit -m "feat: show everyday equivalents beside footer values"`
