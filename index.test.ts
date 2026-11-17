import { test } from "node:test";
import assert from "node:assert/strict";
import register, { formatReport, formatFooter, ceilingProgress, gaugeColor, ENTRY_TYPE, type ImpactEntry } from "./index.ts";
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

const FOOTER = /^⚡ ~.* Wh · ~.* gCO₂e · ~.* mL$/;

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

test("only unknown models: no colour applied", async () => {
	const s = setup();
	let called = false;
	(s.ctx.ui as any).theme = { appearance: "dark", style: (t: string) => ((called = true), t) };
	await s.handlers.message_end(assistant("no-such-model", 50), s.ctx);
	assert.equal(called, false);
});
