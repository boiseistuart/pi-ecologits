# EcoLogits cross-session totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/impact` adds an "All sessions" table (Today / This week / This month / This year / All time) built by scanning every pi session file.

**Architecture:** New `history.ts` scans `*.jsonl` session files, collects `ecologits-impact` entries plus the token usage of the assistant message each one belongs to, dedupes, and buckets them by calendar period. `index.ts` formats the table (reusing `sumImpacts` and the footer's unit helpers) and appends it to the `/impact` report.

**Tech Stack:** TypeScript run by pi; tests with `node --test` (Node 26 type stripping), no npm deps.

**Spec:** `~/.pi/agent/extensions/ecologits/docs/specs/2026-11-23-ecologits-history-totals-design.md`

## Global Constraints

- Impact stays output-only; input/cache tokens are counted, never converted to impact.
- Periods are calendar periods in local time; weeks start Monday. Membership: entry timestamp ≥ period start.
- Dedupe impact entries on `id + timestamp` (IDs are 8-hex, not globally unique).
- Token pairing: an assistant `message` entry whose `parentId` equals an impact entry's `id` in the same file supplies that entry's `input`, `cacheRead`, `cacheWrite` (verified: all 3,180 existing impact entries are the parent of their assistant message). No pair → zeros.
- Malformed lines and unreadable files are skipped, never fatal. A missing root yields all-zero totals.
- Energy/GWP/Water use the footer's midpoint `approx()` formatting. Token counts are compact: `<1000` as integer, else `Number((n/10^k).toPrecision(2))` + `k`/`M`/`B` (e.g. `950`, `1.2k`, `12k`, `1.2M`).
- The caveat appears once, at the end of `/impact` output.
- No first-person pronouns in comments or commit messages.

## Review Focus

1. Forked/cloned sessions: the same impact entry in two files is counted once. Test in Task 1.
2. Corrupt data: a truncated JSON line, a non-`.jsonl` file, and a non-object line are skipped; other entries in the same file still count. Test in Task 1.
3. Unknown models (`ok: false` entries): count toward responses and tokens, contribute no impact. Test in Task 1 (counts) and Task 2 (table).
4. Week/year boundaries: Sunday 23:59 is not in "this week" when now is Monday; Dec 31 is not in "this year" on Jan 1. Test in Task 1.
5. Scan failure in `/impact` (e.g. root unreadable): the session report still shows, with `All sessions: unavailable (<message>)`. Test in Task 2.

---

### Task 1: `history.ts` — scan, pair, dedupe, bucket

**Files:**
- Create: `~/.pi/agent/extensions/ecologits/history.ts`
- Test: `~/.pi/agent/extensions/ecologits/history.test.ts` (fixtures written to `mkdtemp` dirs)

**Interfaces:**
- Consumes: `import type { ImpactEntry } from "./index.ts"` and `ENTRY_TYPE` value `"ecologits-impact"` (redeclare the literal locally to avoid a runtime import cycle).
- Produces:
  - `export type Period = "today" | "week" | "month" | "year" | "all"`
  - `export const PERIODS: Period[] = ["today", "week", "month", "year", "all"]`
  - `export interface PeriodTotals { entries: ImpactEntry[]; input: number; cacheRead: number; cacheWrite: number }`
  - `export type HistoryTotals = Record<Period, PeriodTotals>`
  - `export function periodsFor(ts: Date, now: Date): Period[]` — always includes `"all"`.
  - `export async function scanHistory(root: string, now?: Date): Promise<HistoryTotals>` — `now` defaults to `new Date()`; files found with `readdir(root, { recursive: true })`, read with `readFile`; missing root (ENOENT) → zeros.

- [ ] **Step 1: Write the failing tests**

Helpers: `impact(id, ts, output, ok = true)` builds a `{"type":"custom","customType":"ecologits-impact","id","parentId":"u","timestamp":ts,"data":{provider:"anthropic",model:"m",output,latency:1,ok, impacts: ok ? <Impacts with energy {min:0.001,max:0.003}, others 0> : undefined}}` line; `reply(id, parentId, input, cacheRead, cacheWrite)` builds an assistant `message` line with `usage`. Use `now = new Date(2026, 10, 23, 12)` (Monday, 23 Nov 2026 local).

```ts
test("periodsFor uses local calendar periods with Monday weeks", () => {
	const now = new Date(2026, 10, 23, 12); // Mon
	assert.deepEqual(periodsFor(new Date(2026, 10, 23, 0, 0), now), ["today", "week", "month", "year", "all"]);
	assert.deepEqual(periodsFor(new Date(2026, 10, 22, 23, 59), now), ["month", "year", "all"]); // Sun
	assert.deepEqual(periodsFor(new Date(2026, 9, 31), now), ["year", "all"]);
	assert.deepEqual(periodsFor(new Date(2026, 0, 1), new Date(2027, 0, 1, 9)).includes("year"), false);
});

test("scanHistory pairs tokens, dedupes copies, buckets by period", async () => {
	// dir/a/s1.jsonl: impact i1 (today, output 100) + reply r1 (parent i1, input 5, cacheRead 1000, cacheWrite 50)
	//                 impact i2 (2026-01-15, output 40) with no reply
	// dir/b/fork.jsonl: exact copy of i1 + r1 lines
	const h = await scanHistory(dir, now);
	assert.equal(h.today.entries.length, 1);
	assert.equal(h.today.entries[0].output, 100);
	assert.deepEqual([h.today.input, h.today.cacheRead, h.today.cacheWrite], [5, 1000, 50]);
	assert.equal(h.all.entries.length, 2);
	assert.equal(h.year.entries.length, 2);
	assert.equal(h.month.entries.length, 1);
});

test("scanHistory skips malformed lines and non-jsonl files", async () => {
	// s.jsonl: "{not json", "42", "null", then a valid impact i1 for today; notes.txt containing a valid impact line
	const h = await scanHistory(dir, now);
	assert.equal(h.all.entries.length, 1);
});

test("scanHistory counts unknown-model entries without impacts", async () => {
	// impact(..., ok=false) today, with reply input 7
	const h = await scanHistory(dir, now);
	assert.equal(h.today.entries.length, 1);
	assert.equal(h.today.entries[0].ok, false);
	assert.equal(h.today.input, 7);
});

test("scanHistory returns zeros for a missing root", async () => {
	const h = await scanHistory(join(tmpdir(), "ecologits-missing-" + Date.now()), now);
	for (const p of PERIODS) assert.deepEqual(h[p], { entries: [], input: 0, cacheRead: 0, cacheWrite: 0 });
});
```

- [ ] **Step 2:** Run `node --test history.test.ts`. Expect FAIL (cannot find module `./history.ts`).
- [ ] **Step 3:** Implement `history.ts` per the Interfaces block. Per file: parse lines, collect impact entries and a `parentId → usage` map of assistant messages; then for each impact entry not yet seen (`id + "|" + timestamp`), add to every period from `periodsFor(new Date(entry.timestamp), now)` with its paired tokens. Skip entries with unparseable timestamps.
- [ ] **Step 4:** Run `node --test`. Expect all tests PASS (31 existing + new).
- [ ] **Step 5:** `git add history.ts history.test.ts && git commit -m "feat: scan session files for cross-session impact totals"`

### Task 2: All-sessions table in `/impact`

**Files:**
- Modify: `~/.pi/agent/extensions/ecologits/index.ts` (`formatReport`, new `formatHistory`, `sessionsRoot`, `/impact` handler; header comment adds the new spec)
- Test: `~/.pi/agent/extensions/ecologits/index.test.ts`

**Interfaces:**
- Consumes: `scanHistory`, `PERIODS`, `type HistoryTotals`, `type Period` from `./history.ts`.
- Produces:
  - `export function compact(n: number): string` — token format from Global Constraints.
  - `export function formatHistory(h: HistoryTotals): string` — first line `All sessions`, then a header row and one row per period labelled `Today`, `This week`, `This month`, `This year`, `All time`; columns `Energy`, `GWP`, `Water` (via `approx` on `sumImpacts(entries)`), `Responses` (`entries.length`), `Output` (sum of `entry.output`), `Input`, `Cache read`, `Cache write` (compact). Columns aligned with `padEnd`. No caveat.
  - `formatReport(entries: ImpactEntry[], history?: HistoryTotals | string): string` — unchanged without the second argument. With a `HistoryTotals`, inserts a blank line and `formatHistory(history)` before the caveat; with a string, inserts a blank line and `All sessions: unavailable (<string>)` before the caveat.
  - `export function sessionsRoot(ctx: any): string` — `dirname(sm.getSessionDir())` when `sm.usesDefaultSessionDir?.()` is true; `sm.getSessionDir()` when it returns a dir otherwise; fallback `join(homedir(), ".pi/agent/sessions")`.

- [ ] **Step 1: Write the failing tests**

```ts
test("compact formats token counts", () => {
	assert.deepEqual([0, 950, 1234, 12345, 1_234_567, 2_500_000_000].map(compact), ["0", "950", "1.2k", "12k", "1.2M", "2.5B"]);
});

test("formatHistory lists every period with impacts and tokens", () => {
	// h: all periods share one ok entry with energy mid 0.002 kWh, output 300, input 5, cacheRead 1_200_000, cacheWrite 7288
	const s = formatHistory(h);
	const lines = s.split("\n");
	assert.equal(lines[0], "All sessions");
	assert.match(lines[1], /Energy +GWP +Water +Responses +Output +Input +Cache read +Cache write/);
	assert.deepEqual(lines.slice(2).map((l) => l.split(/ {2,}/)[0]), ["Today", "This week", "This month", "This year", "All time"]);
	assert.match(lines[2], /~2 Wh .* 1 +300 +5 +1\.2M +7\.3k/);
	assert.doesNotMatch(s, /Note:/);
});

test("formatHistory shows unknown-model-only periods as zero impact", () => {
	// h.today has one ok:false entry, output 10
	assert.match(formatHistory(h).split("\n")[2], /~0 Wh .* 1 +10 /);
});

test("formatReport puts the history before a single caveat", () => {
	const r = formatReport([], h);
	assert.ok(r.indexOf("All sessions") < r.indexOf("Note:"));
	assert.equal(r.match(/Note:/g)!.length, 1);
	assert.match(formatReport([], "EACCES"), /All sessions: unavailable \(EACCES\)\nNote:/);
});

test("/impact includes all-sessions totals from the session root", async () => {
	// setup() ctx.sessionManager gains getSessionDir: () => join(tmpRoot, "--proj--"), usesDefaultSessionDir: () => true;
	// tmpRoot/--other--/s.jsonl holds one impact line for today
	await t.commands.impact.handler("", t.ctx);
	assert.match(t.notes[0], /All sessions/);
	assert.match(t.notes[0], /Today .* 1 /);
});

test("sessionsRoot honours custom session dirs", () => {
	assert.equal(sessionsRoot({ sessionManager: { getSessionDir: () => "/x/--p--", usesDefaultSessionDir: () => true } }), "/x");
	assert.equal(sessionsRoot({ sessionManager: { getSessionDir: () => "/custom", usesDefaultSessionDir: () => false } }), "/custom");
	assert.equal(sessionsRoot({}), join(homedir(), ".pi/agent/sessions"));
});
```

- [ ] **Step 2:** Run `node --test`. Expect the new tests to FAIL (missing exports `compact`, `formatHistory`, `sessionsRoot`).
- [ ] **Step 3:** Implement the exports above. In the `/impact` handler, `await scanHistory(sessionsRoot(ctx))` inside `try`; on error pass `String(err.message ?? err)` as the second argument to `formatReport`.
- [ ] **Step 4:** Run `node --test`. Expect all PASS.
- [ ] **Step 5:** Manual check: `node -e 'import("./history.ts").then(async m => { const i = await import("./index.ts"); console.log(i.formatHistory(await m.scanHistory(require("os").homedir()+"/.pi/agent/sessions"))) })'` prints a table with non-zero All time responses (~3,180) in well under 2 s.
- [ ] **Step 6:** `git add index.ts index.test.ts && git commit -m "feat: show cross-session totals in /impact"`
