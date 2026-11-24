import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractProviderConfig, formatReport, missingCases, parseCases, rewritePin, serializeData } from "./sync-lib.ts";

const genPy = readFileSync(new URL("../reference/gen.py", import.meta.url), "utf8");

test("parseCases reads gen.py", () => {
	const cases = parseCases(genPy);
	assert.equal(cases.length, 6);
	assert.deepEqual(cases[0], { provider: "anthropic", model: "claude-opus-5-5" });
	assert.ok(cases.some((c) => c.provider === "openai" && c.model === "gpt-5.3-codex"));
});

test("missingCases finds removed and accepts aliases", () => {
	const upstream = {
		aliases: [{ provider: "anthropic", name: "claude-haiku-4-5", alias: "claude-haiku-4-5-20251001" }],
		models: [{ provider: "anthropic", name: "claude-haiku-4-5-20251001" }],
	};
	const cases = [
		{ provider: "openai", model: "gpt-5-codex" },
		{ provider: "anthropic", model: "claude-haiku-4-5" },
		{ provider: "anthropic", model: "claude-haiku-4-5-20251001" },
	];
	assert.deepEqual(missingCases(cases, upstream), ["openai/gpt-5-codex"]);
});

test("extractProviderConfig returns the PROVIDER_CONFIG_MAP block", () => {
	const block = 'PROVIDER_CONFIG_MAP = {\n    "anthropic": _ProviderConfig(\n        datacenter_pue=1.09,\n    ),\n}';
	const text = `x = PROVIDER_CONFIG_MAP[provider]\n\n${block}\n\n\ndef after():\n    return {}\n}\n`;
	assert.equal(extractProviderConfig(text), block);
	assert.equal(extractProviderConfig("def f():\n    pass\n"), "");
});

test("rewritePin rewrites llm.ts and README forms", () => {
	assert.deepEqual(rewritePin(" * Source: github.com/genai-impact/ecologits @ 3a8e85c\n", "3a8e85c", "4edff3e"), {
		text: " * Source: github.com/genai-impact/ecologits @ 4edff3e\n",
		replaced: true,
	});
	assert.deepEqual(rewritePin("([ecologits](url) @ `3a8e85c`)", "3a8e85c", "4edff3e"), {
		text: "([ecologits](url) @ `4edff3e`)",
		replaced: true,
	});
	assert.deepEqual(rewritePin("nothing here @ abcdef0", "3a8e85c", "4edff3e"), {
		text: "nothing here @ abcdef0",
		replaced: false,
	});
});

test("formatReport shows SHAs, lists, reasons and optional blocks", () => {
	const full = formatReport({
		status: "needs-attention",
		from: "3a8e85c0000000000000000000000000000000000",
		to: "4edff3e0000000000000000000000000000000000",
		reasons: ["Formula changed", "Tests failed"],
		models: { added: ["openai/gpt-6"], changed: [], retained: ["openai/gpt-4"] },
		mixes: { added: [], changed: ["CAF"], retained: [] },
		codeDiff: "-a\n+b",
		testOutput: "not ok 1",
	});
	assert.match(full, /3a8e85c → 4edff3e/);
	assert.match(full, /Retained \(removed upstream\)[\s\S]*openai\/gpt-4/);
	assert.match(full, /^- Formula changed$/m);
	assert.match(full, /^- Tests failed$/m);
	assert.match(full, /```diff\n-a\n\+b\n```/);
	assert.match(full, /```\nnot ok 1\n```/);

	const bare = formatReport({ status: "up-to-date", from: "4edff3e000", to: "4edff3e000", reasons: [] });
	assert.doesNotMatch(bare, /```/);
});

test("serializeData keeps upstream bytes when data equals upstream", () => {
	const raw = '{\n    "x": [\n        1.349e-08,\n        0.0\n    ]\n}';
	assert.equal(serializeData(JSON.parse(raw), raw), raw);
	assert.equal(serializeData({ x: [1.349e-8, 1] }, raw), '{\n    "x": [\n        1.349e-8,\n        1\n    ]\n}');
});
