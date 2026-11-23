/**
 * ecologits: estimates the environmental impact of each assistant response with a
 * TypeScript port of EcoLogits, shows session totals in the footer, and details
 * them via /impact. The footer is coloured green→red by progress toward per-session
 * ceilings and ends with ‼ once a ceiling is reached.
 * Spec: ~/.pi/agent/specs/2026-11-13-ecologits-design.md
 * Spec: ~/.pi/agent/specs/2026-11-16-ecologits-footer-ceiling-design.md
 * Spec: docs/specs/2026-11-23-ecologits-history-totals-design.md (cross-session totals in /impact)
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scanHistory, PERIODS, type HistoryTotals, type Period } from "./history.ts";
import { add, type Impacts, type Range } from "./llm.ts";
import { estimate } from "./lookup.ts";

export const ENTRY_TYPE = "ecologits-impact";
const STATUS_KEY = "ecologits";
const CAVEAT =
	"Note: EcoLogits counts output tokens only; prompt/context processing is not included, so figures likely understate impact.";

export interface ImpactEntry {
	provider: string;
	model: string;
	output: number;
	latency: number;
	ok: boolean;
	impacts?: Impacts;
	warnings?: string[];
}

const ZERO: Range = { min: 0, max: 0 };
const zero = (): Impacts => ({
	energy: ZERO, gwp: ZERO, adpe: ZERO, pe: ZERO, wcf: ZERO,
	usage: { energy: ZERO, gwp: ZERO, adpe: ZERO, pe: ZERO, wcf: ZERO },
	embodied: { gwp: ZERO, adpe: ZERO, pe: ZERO },
});

export function sumImpacts(entries: ImpactEntry[]): Impacts {
	let t = zero();
	for (const e of entries) {
		const i = e.ok ? e.impacts : undefined;
		if (!i) continue;
		t = {
			energy: add(t.energy, i.energy),
			gwp: add(t.gwp, i.gwp),
			adpe: add(t.adpe, i.adpe),
			pe: add(t.pe, i.pe),
			wcf: add(t.wcf, i.wcf),
			usage: {
				energy: add(t.usage.energy, i.usage.energy),
				gwp: add(t.usage.gwp, i.usage.gwp),
				adpe: add(t.usage.adpe, i.usage.adpe),
				pe: add(t.usage.pe, i.usage.pe),
				wcf: add(t.usage.wcf, i.usage.wcf),
			},
			embodied: {
				gwp: add(t.embodied.gwp, i.embodied.gwp),
				adpe: add(t.embodied.adpe, i.embodied.adpe),
				pe: add(t.embodied.pe, i.embodied.pe),
			},
		};
	}
	return t;
}

function num(v: number): string {
	if (v === 0) return "0";
	if (Math.abs(v) < 0.01) return v.toExponential(1);
	if (Math.abs(v) >= 100) return Math.round(v).toString();
	return Number(v.toPrecision(2)).toString();
}

/** Picks the smallest unit ([factor, name] pairs, smallest first) whose value stays below 1000. */
function pickUnit(base: number, units: [number, string][]): [number, string] {
	for (const u of units) if (Math.abs(base * u[0]) < 1000) return u;
	return units[units.length - 1];
}

const ENERGY_UNITS: [number, string][] = [[1000, "Wh"], [1, "kWh"], [0.001, "MWh"]]; // base kWh
const GWP_UNITS: [number, string][] = [[1000, "gCO₂e"], [1, "kgCO₂e"], [0.001, "tCO₂e"]]; // base kg
const WATER_UNITS: [number, string][] = [[1000, "mL"], [1, "L"], [0.001, "m³"]]; // base L

const mid = (r: Range) => (r.min + r.max) / 2;

function approx(r: Range, units: [number, string][]): string {
	const [f, u] = pickUnit(mid(r), units);
	return `~${num(mid(r) * f)} ${u}`;
}

function span(r: Range, units: [number, string][]): string {
	const [f, u] = pickUnit(r.max, units);
	return `${num(r.min * f)}–${num(r.max * f)} ${u}`;
}

/** Per-session ceilings, in footer display units. */
export const CEILING = { energyWh: 50, gwpG: 20, waterMl: 200 };
const CEILING_MARK = "‼";

/** Everyday equivalents: Wh per smartphone charge, gCO₂e per petrol-car mile (~150 g/km), mL per glass of water. */
export const EQUIV = { whPerCharge: 13, gPerMile: 240, mlPerGlass: 200 };

/** Progress toward the nearest ceiling: max of the three midpoint ratios, clamped to [0, 1]. */
export function ceilingProgress(t: Impacts): number {
	const p = Math.max(
		(mid(t.energy) * 1000) / CEILING.energyWh,
		(mid(t.gwp) * 1000) / CEILING.gwpG,
		(mid(t.wcf) * 1000) / CEILING.waterMl,
	);
	return Math.min(1, Math.max(0, p));
}

type Rgb = { kind: "rgb"; r: number; g: number; b: number };

const gaugeHue = (p: number) => 120 * (1 - Math.min(1, Math.max(0, p)));

/** Hue 120° (green) at p=0 to 0° (red) at p=1; darker on light themes for legibility. */
export function gaugeColor(p: number, appearance: "dark" | "light" = "dark"): Rgb {
	return hsv(gaugeHue(p), 0.85, appearance === "light" ? 0.7 : 0.95);
}

/** Same hue as gaugeColor, less saturated and closer to the background so it stands out less. */
export function softGaugeColor(p: number, appearance: "dark" | "light" = "dark"): Rgb {
	return hsv(gaugeHue(p), 0.45, appearance === "light" ? 0.8 : 0.65);
}

function hsv(h: number, s: number, v: number): Rgb {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
	};
	return { kind: "rgb", r: f(5), g: f(3), b: f(1) };
}

export type FooterSegment = { text: string; tone: "main" | "soft" };

/** Footer split into gauge-coloured ("main") and softer ("soft") pieces; joined, they form formatFooter(). */
export function footerSegments(total: Impacts, unknownCurrent?: string, anyKnown = true): FooterSegment[] {
	const segs: FooterSegment[] = [];
	const main = (text: string) => {
		const last = segs.at(-1);
		if (last?.tone === "main") last.text += text;
		else segs.push({ text, tone: "main" });
	};
	const soft = (emoji: string, n: number, unit: string) => segs.push({ text: ` ≈ ${emoji} ${num(n)} ${unit}`, tone: "soft" });
	main("⚡ ");
	if (anyKnown) {
		main(approx(total.energy, ENERGY_UNITS));
		soft("📱", (mid(total.energy) * 1000) / EQUIV.whPerCharge, "charges");
		main(` · ${approx(total.gwp, GWP_UNITS)}`);
		soft("🚗", (mid(total.gwp) * 1000) / EQUIV.gPerMile, "miles");
		main(` · ${approx(total.wcf, WATER_UNITS)}`);
		soft("🥛", (mid(total.wcf) * 1000) / EQUIV.mlPerGlass, "glasses");
	}
	if (unknownCurrent) main(`${anyKnown ? " · " : ""}n/a (${unknownCurrent})`);
	if (anyKnown && ceilingProgress(total) >= 1) segs.push({ text: ` ${CEILING_MARK}`, tone: "main" });
	return segs;
}

export function formatFooter(total: Impacts, unknownCurrent?: string, anyKnown = true): string {
	return footerSegments(total, unknownCurrent, anyKnown).map((s) => s.text).join("");
}

/** Token count: integer below 1000, otherwise two significant digits with k/M/B. */
export function compact(n: number): string {
	if (Math.abs(n) < 1000) return String(Math.round(n));
	const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
	const [f, u] = units.find(([f]) => Math.abs(n) >= f)!;
	return `${Number((n / f).toPrecision(2))}${u}`;
}

const PERIOD_LABELS: Record<Period, string> = {
	today: "Today", week: "This week", month: "This month", year: "This year", all: "All time",
};

export function formatHistory(h: HistoryTotals): string {
	const rows = [["", "Energy", "GWP", "Water", "Responses", "Output", "Input", "Cache read", "Cache write"]];
	for (const p of PERIODS) {
		const { entries, input, cacheRead, cacheWrite } = h[p];
		const t = sumImpacts(entries);
		const output = entries.reduce((s, e) => s + (e.output ?? 0), 0);
		rows.push([
			PERIOD_LABELS[p], approx(t.energy, ENERGY_UNITS), approx(t.gwp, GWP_UNITS), approx(t.wcf, WATER_UNITS),
			String(entries.length), compact(output), compact(input), compact(cacheRead), compact(cacheWrite),
		]);
	}
	const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
	const lines = rows.map((r) => r.map((cell, c) => cell.padEnd(widths[c])).join("  ").trimEnd());
	return ["All sessions", ...lines].join("\n");
}

/** Root of all session files: parent of the per-cwd default dir, or a custom session dir as-is. */
export function sessionsRoot(ctx: any): string {
	const sm = ctx?.sessionManager;
	const dir = sm?.getSessionDir?.();
	if (typeof dir === "string" && dir) return sm.usesDefaultSessionDir?.() ? dirname(dir) : dir;
	return join(homedir(), ".pi/agent/sessions");
}

export function formatReport(entries: ImpactEntry[], history?: HistoryTotals | string): string {
	const t = sumImpacts(entries);
	const sci = (r: Range, unit: string) => `${r.min.toExponential(2)}–${r.max.toExponential(2)} ${unit}`;
	const lines = [
		`EcoLogits impact — this session (${entries.length} response${entries.length === 1 ? "" : "s"})`,
		`  Energy  ${span(t.energy, ENERGY_UNITS)} (usage)`,
		`  GWP     ${span(t.gwp, GWP_UNITS)}  [usage ${span(t.usage.gwp, GWP_UNITS)}, embodied ${span(t.embodied.gwp, GWP_UNITS)}]`,
		`  Water   ${span(t.wcf, WATER_UNITS)} (usage)`,
		`  ADPe    ${sci(t.adpe, "kgSbeq")}  [usage ${sci(t.usage.adpe, "kgSbeq")}, embodied ${sci(t.embodied.adpe, "kgSbeq")}]`,
		`  PE      ${sci(t.pe, "MJ")}  [usage ${sci(t.usage.pe, "MJ")}, embodied ${sci(t.embodied.pe, "MJ")}]`,
		"Models:",
	];
	const byModel = new Map<string, { n: number; out: number; ok: boolean }>();
	for (const e of entries) {
		const key = `${e.provider}/${e.model}`;
		const m = byModel.get(key) ?? { n: 0, out: 0, ok: e.ok };
		m.n++;
		m.out += e.output;
		m.ok = m.ok && e.ok;
		byModel.set(key, m);
	}
	for (const [key, m] of byModel) {
		const base = `  ${key}: ${m.n} response${m.n === 1 ? "" : "s"}, ${m.out} output tokens`;
		lines.push(m.ok ? base : `${base} — not estimated (not in EcoLogits data)`);
	}
	const warnings = [...new Set(entries.flatMap((e) => e.warnings ?? []))];
	if (warnings.length) lines.push(`Warnings: ${warnings.join(", ")} (see https://ecologits.ai/tutorial/warnings_and_errors/)`);
	if (typeof history === "string") lines.push("", `All sessions: unavailable (${history})`);
	else if (history) lines.push("", formatHistory(history));
	lines.push(CAVEAT);
	return lines.join("\n");
}

function readEntries(ctx: any): ImpactEntry[] {
	const out: ImpactEntry[] = [];
	for (const e of ctx.sessionManager?.getEntries?.() ?? []) {
		if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) out.push(e.data as ImpactEntry);
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	let entries: ImpactEntry[] = [];
	let unknownCurrent: string | undefined;

	const refresh = (ctx: any) => {
		if (!ctx.hasUI) return;
		if (entries.length === 0) return ctx.ui.setStatus(STATUS_KEY, undefined);
		const anyKnown = entries.some((e) => e.ok);
		const total = sumImpacts(entries);
		const theme = ctx.ui.theme;
		if (!anyKnown || typeof theme?.style !== "function") {
			return ctx.ui.setStatus(STATUS_KEY, formatFooter(total, unknownCurrent, anyKnown));
		}
		const p = ceilingProgress(total);
		const fg = { main: gaugeColor(p, theme.appearance), soft: softGaugeColor(p, theme.appearance) };
		const colored = footerSegments(total, unknownCurrent, anyKnown)
			.map((s) => theme.style(s.text, { fg: fg[s.tone] }))
			.join("");
		ctx.ui.setStatus(STATUS_KEY, colored);
	};

	pi.on("session_start", async (_event, ctx) => {
		entries = readEntries(ctx);
		const last = entries.at(-1);
		unknownCurrent = last && !last.ok ? last.model : undefined;
		refresh(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		const msg: any = event.message;
		if (msg?.role !== "assistant") return;
		const output = msg.usage?.output ?? 0;
		const latency = typeof msg.timestamp === "number" ? (Date.now() - msg.timestamp) / 1000 : 0;
		const r = estimate(msg.provider, msg.model, output, latency);
		const entry: ImpactEntry = r.ok
			? { provider: msg.provider, model: msg.model, output, latency, ok: true, impacts: r.impacts, warnings: r.warnings }
			: { provider: msg.provider, model: msg.model, output, latency, ok: false };
		entries.push(entry);
		unknownCurrent = r.ok ? undefined : msg.model;
		pi.appendEntry(ENTRY_TYPE, entry);
		refresh(ctx);
	});

	pi.registerCommand("impact", {
		description: "Show estimated environmental impact of this session (EcoLogits)",
		handler: async (_args, ctx) => {
			const fromSession = readEntries(ctx);
			let history: HistoryTotals | string;
			try {
				history = await scanHistory(sessionsRoot(ctx));
			} catch (err: any) {
				history = String(err?.message ?? err);
			}
			const report = formatReport(fromSession.length >= entries.length ? fromSession : entries, history);
			if (ctx.hasUI) ctx.ui.notify(report, "info");
			else console.log(report);
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
