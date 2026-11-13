/**
 * Maps pi provider/model ids to EcoLogits data and computes impacts.
 */
import { readFileSync } from "node:fs";
import { computeLlmImpacts, PROVIDER_CONFIG, type ElectricityMix, type Impacts } from "./llm.ts";

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

interface ModelEntry {
	provider: string;
	name: string;
	architecture: { type: "dense" | "moe"; parameters: any };
	warnings?: string[] | null;
	deployment?: { tps?: number | null; ttft?: number | null } | null;
}

const modelData = load("./data/models.json");
const MODELS = new Map<string, ModelEntry>();
for (const m of modelData.models as ModelEntry[]) MODELS.set(`${m.provider}|${m.name}`, m);
for (const a of modelData.aliases ?? []) {
	const target = MODELS.get(`${a.provider}|${a.alias}`);
	if (target) MODELS.set(`${a.provider}|${a.name}`, target);
}

const MIXES = new Map<string, ElectricityMix & { warnings?: string[] | null }>();
for (const x of load("./data/electricity_mixes.json").electricity_mixes) MIXES.set(x.name, x);

function ecoProvider(p: string): string | null {
	const s = p.toLowerCase();
	if (s === "anthropic" || s.startsWith("anthropic-")) return "anthropic";
	if (s === "openai" || s.startsWith("openai-") || s.startsWith("azure-openai")) return "openai";
	if (s === "google" || s.startsWith("google-") || s === "google_genai" || s === "gemini") return "google_genai";
	if (s === "mistral" || s === "mistralai") return "mistralai";
	if (s === "cohere") return "cohere";
	if (s === "huggingface" || s === "huggingface_hub") return "huggingface_hub";
	return null;
}

export function mapProvider(piProvider: string, modelId: string): { provider: string; model: string } | null {
	const direct = ecoProvider(piProvider);
	if (direct) return { provider: direct, model: modelId };
	const slash = modelId.indexOf("/");
	if (slash > 0) {
		const vendor = ecoProvider(modelId.slice(0, slash));
		if (vendor) return { provider: vendor, model: modelId.slice(slash + 1) };
	}
	return null;
}

const ZERO = { min: 0, max: 0 };
const zeroImpacts = (): Impacts => ({
	energy: ZERO, gwp: ZERO, adpe: ZERO, pe: ZERO, wcf: ZERO,
	usage: { energy: ZERO, gwp: ZERO, adpe: ZERO, pe: ZERO, wcf: ZERO },
	embodied: { gwp: ZERO, adpe: ZERO, pe: ZERO },
});

export function estimate(
	piProvider: string,
	modelId: string,
	outputTokens: number,
	latencySec: number,
): { ok: true; impacts: Impacts; warnings: string[] } | { ok: false; reason: string } {
	const mapped = mapProvider(piProvider, modelId);
	if (!mapped) return { ok: false, reason: `provider ${piProvider} not covered by EcoLogits` };
	const model = MODELS.get(`${mapped.provider}|${mapped.model}`);
	if (!model) return { ok: false, reason: `model ${mapped.model} not in EcoLogits data` };
	const cfg = PROVIDER_CONFIG[mapped.provider];
	const mix = MIXES.get(cfg.location);
	if (!mix) return { ok: false, reason: `no electricity mix for ${cfg.location}` };
	const warnings = [...(model.warnings ?? []), ...(mix.warnings ?? [])];
	// No generated output (aborted/errored): nothing to attribute under an output-token methodology.
	if (!(outputTokens > 0)) return { ok: true, impacts: zeroImpacts(), warnings };
	const p = model.architecture.parameters;
	const moe = model.architecture.type === "moe";
	const impacts = computeLlmImpacts({
		activeParams: moe ? p.active : p,
		totalParams: moe ? p.total : p,
		outputTokens,
		requestLatency: latencySec > 0 ? latencySec : undefined,
		mix,
		pue: cfg.pue,
		wue: cfg.wue,
		tps: model.deployment?.tps,
		ttft: model.deployment?.ttft,
	});
	return { ok: true, impacts, warnings };
}
