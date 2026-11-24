/**
 * Pure helpers for scripts/sync-upstream.ts.
 */
import type { MergeLists } from "./merge.ts";

export type SyncStatus = "up-to-date" | "synced" | "needs-attention";

export interface SyncReport {
	status: SyncStatus;
	from: string;
	to: string;
	reasons: string[];
	models?: MergeLists;
	mixes?: MergeLists;
	codeDiff?: string;
	testOutput?: string;
}

export interface Case {
	provider: string;
	model: string;
}

/** Reference cases from the `CASES = [...]` block of reference/gen.py. */
export function parseCases(genPy: string): Case[] {
	const block = genPy.match(/^CASES = \[([\s\S]*?)^\]/m)?.[1] ?? "";
	return [...block.matchAll(/\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => ({ provider: m[1], model: m[2] }));
}

/** `provider/model` for cases that upstream knows neither as a model nor as an alias. */
export function missingCases(
	cases: Case[],
	upstream: { models: { provider: string; name: string }[]; aliases: { provider: string; name: string }[] },
): string[] {
	const known = new Set([...upstream.models, ...upstream.aliases].map((m) => `${m.provider}/${m.name}`));
	return cases.map((c) => `${c.provider}/${c.model}`).filter((k) => !known.has(k));
}

/** The `PROVIDER_CONFIG_MAP = {` ... `}` block of ecologits/tracers/utils.py, or "". */
export function extractProviderConfig(utilsPy: string): string {
	const lines = utilsPy.split("\n");
	const start = lines.findIndex((l) => l.startsWith("PROVIDER_CONFIG_MAP = {"));
	if (start < 0) return "";
	const end = lines.findIndex((l, i) => i > start && l === "}");
	if (end < 0) return "";
	return lines.slice(start, end + 1).join("\n");
}

/** Replace `@ <old>` and ``@ `<old>` `` pins with the new short SHA. */
export function rewritePin(text: string, oldShort: string, newShort: string): { text: string; replaced: boolean } {
	const re = new RegExp(`@ (\`?)${oldShort}\\1`, "g");
	const out = text.replace(re, (_m, tick) => `@ ${tick}${newShort}${tick}`);
	return { text: out, replaced: out !== text };
}

const short = (sha: string) => sha.slice(0, 7);

function listSection(title: string, lists: MergeLists): string[] {
	const out = [`### ${title}`, ""];
	const rows: [string, string[]][] = [
		["Added", lists.added],
		["Changed", lists.changed],
		["Retained (removed upstream)", lists.retained],
	];
	for (const [label, items] of rows) {
		out.push(`**${label}:** ${items.length}`);
		if (items.length) out.push("", ...items.map((i) => `- \`${i}\``));
		out.push("");
	}
	return out;
}

export function formatReport(r: SyncReport): string {
	const out = [
		"## EcoLogits upstream sync",
		"",
		`Status: **${r.status}** — genai-impact/ecologits ${short(r.from)} → ${short(r.to)}`,
		"",
	];
	if (r.reasons.length) out.push("### Needs attention", "", ...r.reasons.map((x) => `- ${x}`), "");
	if (r.models) out.push(...listSection("Models", r.models));
	if (r.mixes) out.push(...listSection("Electricity mixes", r.mixes));
	if (r.codeDiff) out.push("### Upstream code changes", "", "```diff", r.codeDiff, "```", "");
	if (r.testOutput) out.push("### Test output", "", "```", r.testOutput, "```", "");
	return out.join("\n");
}
