import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimate, mapProvider } from "./lookup.ts";

const refs = JSON.parse(readFileSync(new URL("./reference/reference.json", import.meta.url), "utf8"));

test("mapProvider: direct anthropic", () => {
	assert.deepEqual(mapProvider("anthropic", "claude-opus-5-5"), { provider: "anthropic", model: "claude-opus-5-5" });
});

test("mapProvider: openai-codex -> openai", () => {
	assert.equal(mapProvider("openai-codex", "gpt-5.3-codex")?.provider, "openai");
});

test("mapProvider: openrouter vendor prefix", () => {
	assert.deepEqual(mapProvider("openrouter", "anthropic/claude-opus-5-5"), {
		provider: "anthropic",
		model: "claude-opus-5-5",
	});
});

test("mapProvider: google -> google_genai, unknown -> null", () => {
	assert.equal(mapProvider("google", "gemini-x")?.provider, "google_genai");
	assert.equal(mapProvider("llama-cpp", "qwen"), null);
});

test("estimate matches Python reference for claude-opus-5-5", () => {
	const r = estimate("anthropic", "claude-opus-5-5", 500, 6.0);
	assert.ok(r.ok);
	const ref = refs.find((x: any) => x.model === "claude-opus-5-5").impacts;
	for (const k of ["energy", "gwp", "wcf"] as const) {
		assert.ok(Math.abs(r.impacts[k].min - ref[k].min) <= Math.abs(ref[k].min) * 1e-9);
		assert.ok(Math.abs(r.impacts[k].max - ref[k].max) <= Math.abs(ref[k].max) * 1e-9);
	}
	assert.ok(r.warnings.includes("model-arch-not-released"));
});

test("estimate resolves dated openai model", () => {
	assert.equal(estimate("openai", "gpt-5-2025-08-07", 800, 1.0).ok, true);
});

test("estimate resolves alias claude-haiku-4-5", () => {
	assert.equal(estimate("anthropic", "claude-haiku-4-5", 10, 1.0).ok, true);
});

test("estimate with zero output tokens gives zero energy", () => {
	const r = estimate("anthropic", "claude-opus-5-5", 0, 1.0);
	assert.ok(r.ok);
	assert.deepEqual(r.impacts.energy, { min: 0, max: 0 });
});

test("estimate unknown model is not ok", () => {
	assert.equal(estimate("anthropic", "no-such-model", 10, 1).ok, false);
});
