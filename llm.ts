/**
 * TypeScript port of EcoLogits' LLM impact formula.
 * Source: github.com/genai-impact/ecologits @ 3a8e85c
 *   ecologits/impacts/llm.py (constants, DAG, compute_llm_impacts)
 *   ecologits/tracers/utils.py (PROVIDER_CONFIG_MAP)
 * Spec: ~/.pi/agent/specs/2026-11-13-ecologits-design.md
 */

export type Range = { min: number; max: number };
export type VR = number | Range;

export interface Impacts {
	energy: Range; // kWh
	gwp: Range; // kgCO2eq
	adpe: Range; // kgSbeq
	pe: Range; // MJ
	wcf: Range; // L
	usage: { energy: Range; gwp: Range; adpe: Range; pe: Range; wcf: Range };
	embodied: { gwp: Range; adpe: Range; pe: Range };
}

export interface ElectricityMix {
	gwp: number;
	adpe: number;
	pe: number;
	wue: number;
}

const MODEL_QUANTIZATION_BITS = 16;
const GPU_ENERGY_ALPHA = 1.1665273170451914e-6;
const GPU_ENERGY_BETA = -0.011205921025579175;
const GPU_ENERGY_GAMMA = 4.052928146734005e-5;
const LATENCY_ALPHA = 0.0006785088094353663;
const LATENCY_BETA = 0.0003119310311688259;
const LATENCY_GAMMA = 0.019473717579473387;
const GPU_MEMORY = 80; // GB
const GPU_EMBODIED_IMPACT_GWP = 273;
const GPU_EMBODIED_IMPACT_ADPE = 0.00895;
const GPU_EMBODIED_IMPACT_PE = 3721;
const SERVER_GPUS = 8;
const SERVER_POWER = 1.2; // kW
const SERVER_EMBODIED_IMPACT_GWP = 5700;
const SERVER_EMBODIED_IMPACT_ADPE = 0.37;
const SERVER_EMBODIED_IMPACT_PE = 70000;
const HARDWARE_LIFESPAN = 3 * 365 * 24 * 60 * 60;
const BATCH_SIZE = 64;

/** Datacenter assumptions per EcoLogits provider (PROVIDER_CONFIG_MAP). */
export const PROVIDER_CONFIG: Record<string, { location: string; pue: VR; wue: VR }> = {
	anthropic: { location: "USA", pue: { min: 1.09, max: 1.14 }, wue: { min: 0.13, max: 0.999 } },
	cohere: { location: "USA", pue: 1.09, wue: 0.999 },
	google_genai: { location: "USA", pue: 1.09, wue: 0.999 },
	huggingface_hub: { location: "USA", pue: { min: 1.09, max: 1.14 }, wue: { min: 0.13, max: 0.99 } },
	mistralai: { location: "SWE", pue: 1.16, wue: 0.09 },
	openai: { location: "USA", pue: 1.2, wue: 0.569 },
};

export const toRange = (v: VR): Range => (typeof v === "number" ? { min: v, max: v } : v);
const scale = (r: Range, k: number): Range => ({ min: r.min * k, max: r.max * k });
export const add = (a: Range, b: Range): Range => ({ min: a.min + b.min, max: a.max + b.max });

interface RunResult {
	energy: Range;
	usage: { gwp: Range; adpe: Range; pe: Range; wcf: Range };
	embodied: { gwp: number; adpe: number; pe: number };
}

/** One DAG execution with scalar parameter counts (billions). */
function runDag(
	active: number,
	total: number,
	outputTokens: number,
	requestLatency: number,
	mix: ElectricityMix,
	pue: Range,
	wue: Range,
	tps: number | null | undefined,
	ttft: number | null | undefined,
): RunResult {
	const gpuEnergyPerToken =
		(GPU_ENERGY_ALPHA * Math.exp(GPU_ENERGY_BETA * BATCH_SIZE) * active + GPU_ENERGY_GAMMA) / 1000;
	const gpuEnergy = outputTokens * gpuEnergyPerToken;

	const latencyPerToken =
		tps == null ? LATENCY_ALPHA * active + LATENCY_BETA * BATCH_SIZE + LATENCY_GAMMA : 1 / tps;
	const gpuLatency = outputTokens * latencyPerToken + (ttft || 0);
	const generationLatency = requestLatency < gpuLatency ? requestLatency : gpuLatency;

	const requiredMemory = (1.2 * total * MODEL_QUANTIZATION_BITS) / 8;
	const gpuNb = Math.ceil(requiredMemory / GPU_MEMORY);
	const gpuCount = 2 ** Math.ceil(Math.log2(gpuNb));

	const serverEnergy =
		(generationLatency / 3600) * SERVER_POWER * (gpuCount / SERVER_GPUS) * (1 / BATCH_SIZE);
	const itEnergy = serverEnergy + gpuCount * gpuEnergy;
	const energy = scale(pue, itEnergy);

	const share = gpuCount / SERVER_GPUS;
	const embodiedFactor = generationLatency / (HARDWARE_LIFESPAN * BATCH_SIZE);
	return {
		energy,
		usage: {
			gwp: scale(energy, mix.gwp),
			adpe: scale(energy, mix.adpe),
			pe: scale(energy, mix.pe),
			wcf: scale(add(wue, scale(pue, mix.wue)), itEnergy),
		},
		embodied: {
			gwp: embodiedFactor * (share * SERVER_EMBODIED_IMPACT_GWP + gpuCount * GPU_EMBODIED_IMPACT_GWP),
			adpe: embodiedFactor * (share * SERVER_EMBODIED_IMPACT_ADPE + gpuCount * GPU_EMBODIED_IMPACT_ADPE),
			pe: embodiedFactor * (share * SERVER_EMBODIED_IMPACT_PE + gpuCount * GPU_EMBODIED_IMPACT_PE),
		},
	};
}

/** Port of compute_llm_impacts: min-params run gives the lower bound, max-params run the upper. */
export function computeLlmImpacts(p: {
	activeParams: VR;
	totalParams: VR;
	outputTokens: number;
	requestLatency?: number;
	mix: ElectricityMix;
	pue: VR;
	wue: VR;
	tps?: number | null;
	ttft?: number | null;
}): Impacts {
	const active = toRange(p.activeParams);
	const total = toRange(p.totalParams);
	const latency = p.requestLatency ?? Infinity;
	const pue = toRange(p.pue);
	const wue = toRange(p.wue);
	const lo = runDag(active.min, total.min, p.outputTokens, latency, p.mix, pue, wue, p.tps, p.ttft);
	const hi = runDag(active.max, total.max, p.outputTokens, latency, p.mix, pue, wue, p.tps, p.ttft);
	const span = (a: Range, b: Range): Range => ({ min: a.min, max: b.max });

	const energy = span(lo.energy, hi.energy);
	const usage = {
		energy,
		gwp: span(lo.usage.gwp, hi.usage.gwp),
		adpe: span(lo.usage.adpe, hi.usage.adpe),
		pe: span(lo.usage.pe, hi.usage.pe),
		wcf: span(lo.usage.wcf, hi.usage.wcf),
	};
	const embodied = {
		gwp: { min: lo.embodied.gwp, max: hi.embodied.gwp },
		adpe: { min: lo.embodied.adpe, max: hi.embodied.adpe },
		pe: { min: lo.embodied.pe, max: hi.embodied.pe },
	};
	return {
		energy,
		gwp: add(usage.gwp, embodied.gwp),
		adpe: add(usage.adpe, embodied.adpe),
		pe: add(usage.pe, embodied.pe),
		wcf: usage.wcf,
		usage,
		embodied,
	};
}
