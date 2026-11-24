import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMixes, mergeModels, type MixesFile, type ModelsFile } from "./merge.ts";

const model = (name: string, tps = 50) => ({
	type: "model",
	provider: "openai",
	name,
	architecture: { type: "dense", parameters: 100 },
	deployment: { tps, ttft: 1 },
});
const alias = (name: string, target: string) => ({ type: "alias", provider: "openai", name, alias: target });

test("mergeModels keeps local-only models and lists them as retained", () => {
	const local: ModelsFile = { aliases: [], models: [model("gpt-4"), model("gpt-5", 50)] };
	const upstream: ModelsFile = { aliases: [], models: [model("gpt-5", 60), model("gpt-6")] };
	const r = mergeModels(local, upstream);
	assert.deepEqual(
		r.data.models.map((m) => m.name),
		["gpt-5", "gpt-6", "gpt-4"],
	);
	assert.equal(r.data.models[0], upstream.models[0]);
	assert.deepEqual(r.added, ["openai/gpt-6"]);
	assert.deepEqual(r.changed, ["openai/gpt-5"]);
	assert.deepEqual(r.retained, ["openai/gpt-4"]);
});

test("mergeModels is identity when local equals upstream", () => {
	const u: ModelsFile = { aliases: [alias("a", "gpt-5")], models: [model("gpt-5"), model("gpt-6")] };
	const r = mergeModels(structuredClone(u), u);
	assert.deepEqual(r.data, u);
	assert.deepEqual([r.added, r.changed, r.retained], [[], [], []]);
});

test("mergeModels alias rules", () => {
	const local: ModelsFile = {
		aliases: [alias("a", "y"), alias("b", "gpt-4"), alias("c", "gone")],
		models: [model("gpt-4"), model("x"), model("y")],
	};
	const upstream: ModelsFile = { aliases: [alias("a", "x")], models: [model("x"), model("y")] };
	const r = mergeModels(local, upstream);
	assert.deepEqual(
		r.data.aliases.map((a) => `${a.name}->${a.alias}`),
		["a->x", "b->gpt-4"],
	);
});

test("mergeMixes keeps local-only zones; upstream values win", () => {
	const mix = (name: string, gwp: number) => ({ name, adpe: 1, pe: 2, gwp, wue: 3 });
	const local: MixesFile = { electricity_mixes: [mix("CAF", 0), mix("USA", 0.4), mix("XXX", 1)] };
	const upstream: MixesFile = { electricity_mixes: [mix("CAF", 0.024), mix("USA", 0.4)] };
	const r = mergeMixes(local, upstream);
	assert.deepEqual(
		r.data.electricity_mixes.map((m) => [m.name, m.gwp]),
		[
			["CAF", 0.024],
			["USA", 0.4],
			["XXX", 1],
		],
	);
	assert.deepEqual(r.added, []);
	assert.deepEqual(r.changed, ["CAF"]);
	assert.deepEqual(r.retained, ["XXX"]);
});
