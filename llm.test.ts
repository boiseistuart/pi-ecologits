import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeLlmImpacts, PROVIDER_CONFIG, type Range } from "./llm.ts";

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const refs = load("./reference/reference.json");
const models = load("./data/models.json");
const mixes = load("./data/electricity_mixes.json").electricity_mixes;

function findModel(provider: string, name: string) {
	const direct = models.models.find((m: any) => m.provider === provider && m.name === name);
	if (direct) return direct;
	const alias = models.aliases.find((a: any) => a.provider === provider && a.name === name);
	return models.models.find((m: any) => m.provider === provider && m.name === alias.alias);
}

function close(actual: Range, expected: Range, label: string) {
	for (const k of ["min", "max"] as const) {
		const e = expected[k];
		const a = actual[k];
		const tol = Math.abs(e) * 1e-9 + 1e-300;
		assert.ok(Math.abs(a - e) <= tol, `${label}.${k}: ${a} != ${e}`);
	}
}

for (const ref of refs) {
	test(`matches Python for ${ref.provider}/${ref.model}`, () => {
		const m = findModel(ref.provider, ref.model);
		const p = m.architecture.parameters;
		const moe = m.architecture.type === "moe";
		const cfg = PROVIDER_CONFIG[ref.provider];
		const mix = mixes.find((x: any) => x.name === cfg.location);
		const got = computeLlmImpacts({
			activeParams: moe ? p.active : p,
			totalParams: moe ? p.total : p,
			outputTokens: ref.output,
			requestLatency: ref.latency,
			mix,
			pue: cfg.pue,
			wue: cfg.wue,
			tps: m.deployment?.tps,
			ttft: m.deployment?.ttft,
		});
		const exp = ref.impacts;
		for (const k of ["energy", "gwp", "adpe", "pe", "wcf"] as const) close(got[k], exp[k], k);
		for (const k of ["energy", "gwp", "adpe", "pe", "wcf"] as const) close(got.usage[k], exp.usage[k], `usage.${k}`);
		for (const k of ["gwp", "adpe", "pe"] as const) close(got.embodied[k], exp.embodied[k], `embodied.${k}`);
	});
}
