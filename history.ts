/**
 * Cross-session totals: scans pi session files for ecologits-impact entries, pairs each
 * with the token usage of the assistant message it precedes, dedupes copies made by
 * fork/clone, and buckets by local calendar period.
 * Spec: docs/specs/2026-11-23-ecologits-history-totals-design.md
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImpactEntry } from "./index.ts";

const ENTRY_TYPE = "ecologits-impact"; // mirrors index.ts; a value import would create a cycle

export type Period = "today" | "week" | "month" | "year" | "all";
export const PERIODS: Period[] = ["today", "week", "month", "year", "all"];

export interface PeriodTotals { entries: ImpactEntry[]; input: number; cacheRead: number; cacheWrite: number }
export type HistoryTotals = Record<Period, PeriodTotals>;

/** Calendar periods (local time, Monday weeks) that contain ts, relative to now. */
export function periodsFor(ts: Date, now: Date): Period[] {
	const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const week = new Date(day);
	week.setDate(day.getDate() - ((day.getDay() + 6) % 7));
	const starts: [Period, Date][] = [
		["today", day],
		["week", week],
		["month", new Date(now.getFullYear(), now.getMonth(), 1)],
		["year", new Date(now.getFullYear(), 0, 1)],
	];
	const out: Period[] = [];
	for (const [p, start] of starts) if (ts >= start) out.push(p);
	out.push("all");
	return out;
}

type Usage = { input: number; cacheRead: number; cacheWrite: number };

function parse(line: string): any {
	try {
		const v = JSON.parse(line);
		return v && typeof v === "object" ? v : undefined;
	} catch {
		return undefined;
	}
}

export async function scanHistory(root: string, now: Date = new Date()): Promise<HistoryTotals> {
	const totals = Object.fromEntries(
		PERIODS.map((p) => [p, { entries: [], input: 0, cacheRead: 0, cacheWrite: 0 }]),
	) as unknown as HistoryTotals;
	let files: string[];
	try {
		files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith(".jsonl"));
	} catch (err: any) {
		if (err?.code === "ENOENT") return totals;
		throw err;
	}
	const seen = new Set<string>();
	for (const f of files) {
		let text: string;
		try {
			text = await readFile(join(root, f), "utf8");
		} catch {
			continue;
		}
		const impacts: any[] = [];
		const usageByParent = new Map<string, Usage>();
		for (const line of text.split("\n")) {
			if (!line.includes(ENTRY_TYPE) && !line.includes('"assistant"')) continue;
			const e = parse(line);
			if (!e) continue;
			if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) impacts.push(e);
			else if (e.type === "message" && e.message?.role === "assistant" && typeof e.parentId === "string") {
				const u = e.message.usage ?? {};
				usageByParent.set(e.parentId, { input: u.input ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0 });
			}
		}
		for (const e of impacts) {
			const ts = new Date(e.timestamp);
			if (Number.isNaN(ts.getTime())) continue;
			const key = `${e.id}|${e.timestamp}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const u = usageByParent.get(e.id) ?? { input: 0, cacheRead: 0, cacheWrite: 0 };
			for (const p of periodsFor(ts, now)) {
				const t = totals[p];
				t.entries.push(e.data as ImpactEntry);
				t.input += u.input;
				t.cacheRead += u.cacheRead;
				t.cacheWrite += u.cacheWrite;
			}
		}
	}
	return totals;
}
