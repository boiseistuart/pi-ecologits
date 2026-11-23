import { test } from "node:test";
import assert from "node:assert/strict";
import register, {
	formatReport, formatFooter, footerSegments, ceilingProgress, gaugeColor, softGaugeColor, ENTRY_TYPE, type ImpactEntry,
	compact, formatHistory, sessionsRoot,
} from "./index.ts";
import { PERIODS, type HistoryTotals } from "./history.ts";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { estimate } from "./lookup.ts";

type Handler = (event: any, ctx: any) => unknown;

function setup(persisted: ImpactEntry[] = []) {
	const handlers: Record<string, Handler> = {};
	const commands: Record<string, any> = {};
	const appended: { type: string; data: ImpactEntry }[] = [];
	const statuses: (string | undefined)[] = [];
	const notes: string[] = [];
	const pi = {
		on: (name: string, fn: Handler) => (handlers[name] = fn),
		registerCommand: (name: string, opts: any) => (commands[name] = opts),
		appendEntry: (type: string, data: ImpactEntry) => appended.push({ type, data }),
	};
	const ctx = {
		hasUI: true,
		ui: {
			setStatus: (_key: string, s: string | undefined) => statuses.push(s),
			notify: (m: string) => notes.push(m),
		},
		sessionManager: {
			getEntries: () => persisted.map((data, i) => ({ type: "custom", id: `e${i}`, customType: ENTRY_TYPE, data })),
		},
	};
	register(pi as never);
	return { handlers, commands, appended, statuses, notes, ctx };
}

const assistant = (model: string, output: number) => ({
	message: { role: "assistant", provider: "anthropic", model, usage: { output }, timestamp: Date.now() - 6000 },
});

const FOOTER = /^⚡ ~.* Wh ≈ 📱 .* charges · ~.* gCO₂e ≈ 🚗 .* miles · ~.* mL ≈ 🥛 .* glasses$/;

test("assistant message_end persists an entry and sets the footer", async () => {
	const s = setup();
	await s.handlers.message_end(assistant("claude-opus-5-5", 500), s.ctx);
	assert.equal(s.appended.length, 1);
	assert.equal(s.appended[0].type, ENTRY_TYPE);
	assert.equal(s.appended[0].data.ok, true);
	assert.match(s.statuses.at(-1)!, FOOTER);
});

test("non-assistant messages are ignored", async () => {
	const s = setup();
	await s.handlers.message_end({ message: { role: "user" } }, s.ctx);
	await s.handlers.message_end({ message: { role: "toolResult" } }, s.ctx);
	assert.equal(s.appended.length, 0);
});

test("unknown model is recorded as not ok and marked n/a", async () => {
	const s = setup();
	await s.handlers.message_end(assistant("no-such-model", 50), s.ctx);
	assert.equal(s.appended[0].data.ok, false);
	assert.match(s.statuses.at(-1)!, /n\/a \(no-such-model\)/);
});

function entry(model: string, output: number, latency: number): ImpactEntry {
	const r = estimate("anthropic", model, output, latency);
	return r.ok
		? { provider: "anthropic", model, output, latency, ok: true, impacts: r.impacts, warnings: r.warnings }
		: { provider: "anthropic", model, output, latency, ok: false };
}

test("session_start restores totals from persisted entries", async () => {
	const s = setup([entry("claude-opus-5-5", 500, 6), entry("claude-opus-5-5", 500, 6)]);
	await s.handlers.session_start({ reason: "resume" }, s.ctx);
	const single = setup([entry("claude-opus-5-5", 500, 6)]);
	await single.handlers.session_start({ reason: "resume" }, single.ctx);
	assert.match(s.statuses.at(-1)!, FOOTER);
	assert.notEqual(s.statuses.at(-1), single.statuses.at(-1));
});

test("formatReport covers metrics, models, unknowns and caveat", () => {
	const text = formatReport([entry("claude-opus-5-5", 500, 6), entry("claude-opus-5-5", 100, 2), entry("no-such-model", 5, 1)]);
	for (const word of ["Energy", "GWP", "Water", "ADPe", "PE", "usage", "embodied"]) assert.ok(text.includes(word), word);
	assert.match(text, /anthropic\/claude-opus-5-5.*2 responses/);
	assert.match(text, /anthropic\/no-such-model.*1 response.*not estimated/);
	assert.ok(text.includes("model-arch-not-released"));
	assert.ok(
		text.includes(
			"Note: EcoLogits counts output tokens only; prompt/context processing is not included, so figures likely understate impact.",
		),
	);
});

test("/impact command notifies the report", async () => {
	const s = setup([entry("claude-opus-5-5", 500, 6)]);
	await s.commands.impact.handler("", s.ctx);
	assert.ok(s.notes[0].includes("Energy"));
});

// --- Ceiling gauge (spec: ~/.pi/agent/specs/2026-11-16-ecologits-footer-ceiling-design.md)

const r = (v: number) => ({ min: v, max: v });
function totals(energyKWh: number, gwpKg: number, waterL: number) {
	const z = r(0);
	return {
		energy: r(energyKWh), gwp: r(gwpKg), adpe: z, pe: z, wcf: r(waterL),
		usage: { energy: r(energyKWh), gwp: r(gwpKg), adpe: z, pe: z, wcf: r(waterL) },
		embodied: { gwp: z, adpe: z, pe: z },
	};
}

test("ceilingProgress uses the largest ratio, clamped to 1", () => {
	assert.equal(ceilingProgress(totals(0, 0, 0)), 0);
	assert.equal(ceilingProgress(totals(0.025, 0.001, 0.01)), 0.5);
	assert.equal(ceilingProgress(totals(0.001, 0.04, 0.01)), 1);
	assert.equal(ceilingProgress(totals(0.001, 0.001, 0.15)), 0.75);
});

test("gaugeColor runs green → yellow → red and clamps", () => {
	const g = gaugeColor(0);
	assert.equal(g.kind, "rgb");
	assert.ok(g.g > g.r && g.b <= g.r);
	const red = gaugeColor(1);
	assert.ok(red.r > red.g && red.r > red.b);
	const y = gaugeColor(0.5);
	assert.ok(Math.abs(y.r - y.g) <= 1 && y.b < y.r);
	assert.deepEqual(gaugeColor(2), gaugeColor(1));
	assert.deepEqual(gaugeColor(-1), gaugeColor(0));
	const light = gaugeColor(0.5, "light");
	assert.ok(light.r < y.r, "light theme is darker");
});

test("formatFooter appends ‼ last once a ceiling is reached", () => {
	assert.match(formatFooter(totals(0.05, 0.001, 0.01)), / ‼$/);
	assert.doesNotMatch(formatFooter(totals(0.01, 0.001, 0.01)), /‼/);
	assert.match(formatFooter(totals(0.1, 0.1, 1), "x"), /n\/a \(x\) ‼$/);
	assert.doesNotMatch(formatFooter(totals(0.1, 0.1, 1), "x", false), /‼/);
});

test("footer is coloured through the theme when one exists", async () => {
	const s = setup();
	const styled: any[] = [];
	(s.ctx.ui as any).theme = { appearance: "dark", style: (t: string, o: any) => (styled.push(o), `<${o.fg.kind}>${t}`) };
	await s.handlers.message_end(assistant("claude-opus-5-5", 500), s.ctx);
	assert.match(s.statuses.at(-1)!, /^<rgb>⚡ /);
	assert.ok(styled[0].fg.g > styled[0].fg.r, "small session is green");
});

// --- Everyday equivalents (spec: ~/.pi/agent/specs/2026-11-17-ecologits-footer-equivalents-design.md)

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
	assert.match(s.statuses.at(-1)!, FOOTER);
});

test("no theme: status equals the plain formatFooter string", async () => {
	const s = setup();
	await s.handlers.message_end(assistant("claude-opus-5-5", 500), s.ctx);
	assert.match(s.statuses.at(-1)!, FOOTER);
});

test("only unknown models: no colour applied", async () => {
	const s = setup();
	let called = false;
	(s.ctx.ui as any).theme = { appearance: "dark", style: (t: string) => ((called = true), t) };
	await s.handlers.message_end(assistant("no-such-model", 50), s.ctx);
	assert.equal(called, false);
});

// --- Cross-session totals (spec: docs/specs/2026-11-23-ecologits-history-totals-design.md)

function history(entries: ImpactEntry[], input = 0, cacheRead = 0, cacheWrite = 0): HistoryTotals {
	return Object.fromEntries(PERIODS.map((p) => [p, { entries, input, cacheRead, cacheWrite }])) as HistoryTotals;
}
const okEntry: ImpactEntry = { provider: "anthropic", model: "m", output: 300, latency: 1, ok: true, impacts: totals(0.002, 0, 0) };

test("compact formats token counts", () => {
	assert.deepEqual([0, 950, 1234, 12345, 1_234_567, 2_500_000_000].map(compact), ["0", "950", "1.2k", "12k", "1.2M", "2.5B"]);
});

test("formatHistory lists every period with impacts and tokens", () => {
	const s = formatHistory(history([okEntry], 5, 1_200_000, 7288));
	const lines = s.split("\n");
	assert.equal(lines[0], "All sessions");
	assert.match(lines[1], /Energy +GWP +Water +Responses +Output +Input +Cache read +Cache write/);
	assert.deepEqual(lines.slice(2).map((l) => l.split(/ {2,}/)[0]), ["Today", "This week", "This month", "This year", "All time"]);
	assert.match(lines[2], /~2 Wh .* 1 +300 +5 +1\.2M +7\.3k/);
	assert.doesNotMatch(s, /Note:/);
});

test("formatHistory shows unknown-model-only periods as zero impact", () => {
	const unknown: ImpactEntry = { provider: "anthropic", model: "x", output: 10, latency: 1, ok: false };
	assert.match(formatHistory(history([unknown])).split("\n")[2], /~0 Wh .* 1 +10 /);
});

test("formatReport puts the history before a single caveat", () => {
	const r = formatReport([], history([okEntry]));
	assert.ok(r.indexOf("All sessions") < r.indexOf("Note:"));
	assert.equal(r.match(/Note:/g)!.length, 1);
	assert.match(formatReport([], "EACCES"), /All sessions: unavailable \(EACCES\)\nNote:/);
});

test("/impact includes all-sessions totals from the session root", async () => {
	const tmpRoot = await mkdtemp(join(tmpdir(), "ecologits-root-"));
	await mkdir(join(tmpRoot, "--other--"));
	const line = JSON.stringify({ type: "custom", customType: ENTRY_TYPE, id: "a1", parentId: null, timestamp: new Date().toISOString(), data: okEntry });
	await writeFile(join(tmpRoot, "--other--", "s.jsonl"), line + "\n");
	const s = setup();
	Object.assign(s.ctx.sessionManager, { getSessionDir: () => join(tmpRoot, "--proj--"), usesDefaultSessionDir: () => true });
	await s.commands.impact.handler("", s.ctx);
	assert.match(s.notes[0], /All sessions/);
	assert.match(s.notes[0], /Today .* 1 +300 /);
});

test("/impact still reports the session when the scan fails", async () => {
	const tmpRoot = await mkdtemp(join(tmpdir(), "ecologits-bad-"));
	const file = join(tmpRoot, "not-a-dir");
	await writeFile(file, "");
	const s = setup([entry("claude-opus-5-5", 500, 6)]);
	Object.assign(s.ctx.sessionManager, { getSessionDir: () => file, usesDefaultSessionDir: () => false });
	await s.commands.impact.handler("", s.ctx);
	assert.match(s.notes[0], /Energy/);
	assert.match(s.notes[0], /All sessions: unavailable \(.+\)\nNote:/);
});

test("sessionsRoot honours custom session dirs", () => {
	assert.equal(sessionsRoot({ sessionManager: { getSessionDir: () => "/x/--p--", usesDefaultSessionDir: () => true } }), "/x");
	assert.equal(sessionsRoot({ sessionManager: { getSessionDir: () => "/custom", usesDefaultSessionDir: () => false } }), "/custom");
	assert.equal(sessionsRoot({}), join(homedir(), ".pi/agent/sessions"));
});
