import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { periodsFor, scanHistory, PERIODS } from "./history.ts";

const now = new Date(2026, 10, 23, 12); // Monday 23 Nov 2026, local
const today = new Date(2026, 10, 23, 9).toISOString();

const r = (v: number) => ({ min: v, max: v });
const z = r(0);
const impacts = {
	energy: { min: 0.001, max: 0.003 }, gwp: z, adpe: z, pe: z, wcf: z,
	usage: { energy: { min: 0.001, max: 0.003 }, gwp: z, adpe: z, pe: z, wcf: z },
	embodied: { gwp: z, adpe: z, pe: z },
};

function impact(id: string, ts: string, output: number, ok = true): string {
	return JSON.stringify({
		type: "custom", customType: "ecologits-impact", id, parentId: "u", timestamp: ts,
		data: { provider: "anthropic", model: "m", output, latency: 1, ok, impacts: ok ? impacts : undefined },
	});
}

function reply(id: string, parentId: string, input: number, cacheRead: number, cacheWrite: number): string {
	return JSON.stringify({
		type: "message", id, parentId, timestamp: today,
		message: { role: "assistant", usage: { input, output: 0, cacheRead, cacheWrite } },
	});
}

async function root(files: Record<string, string[]>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ecologits-hist-"));
	for (const [rel, lines] of Object.entries(files)) {
		const p = join(dir, rel);
		await mkdir(join(p, ".."), { recursive: true });
		await writeFile(p, lines.join("\n") + "\n");
	}
	return dir;
}

test("periodsFor uses local calendar periods with Monday weeks", () => {
	assert.deepEqual(periodsFor(new Date(2026, 10, 23, 0, 0), now), ["today", "week", "month", "year", "all"]);
	assert.deepEqual(periodsFor(new Date(2026, 10, 22, 23, 59), now), ["month", "year", "all"]); // Sunday
	assert.deepEqual(periodsFor(new Date(2026, 9, 31), now), ["year", "all"]);
	assert.equal(periodsFor(new Date(2026, 11, 31, 23), new Date(2027, 0, 1, 9)).includes("year"), false);
	// Sunday as "now": week began the previous Monday
	assert.ok(periodsFor(new Date(2026, 10, 23, 8), new Date(2026, 10, 29, 20)).includes("week"));
});

test("scanHistory pairs tokens, dedupes copies, buckets by period", async () => {
	const s1 = [impact("i1", today, 100), reply("r1", "i1", 5, 1000, 50), impact("i2", "2026-01-15T10:00:00.000Z", 40)];
	const dir = await root({ "a/s1.jsonl": s1, "b/fork.jsonl": s1.slice(0, 2) });
	const h = await scanHistory(dir, now);
	assert.equal(h.today.entries.length, 1);
	assert.equal(h.today.entries[0].output, 100);
	assert.deepEqual([h.today.input, h.today.cacheRead, h.today.cacheWrite], [5, 1000, 50]);
	assert.equal(h.all.entries.length, 2);
	assert.equal(h.year.entries.length, 2);
	assert.equal(h.month.entries.length, 1);
	assert.equal(h.all.input, 5);
});

test("scanHistory skips malformed lines and non-jsonl files", async () => {
	const dir = await root({
		"s.jsonl": ["{not json", "42", "null", impact("i1", today, 10)],
		"notes.txt": [impact("i9", today, 10)],
	});
	const h = await scanHistory(dir, now);
	assert.equal(h.all.entries.length, 1);
});

test("scanHistory counts unknown-model entries without impacts", async () => {
	const dir = await root({ "s.jsonl": [impact("i1", today, 10, false), reply("r1", "i1", 7, 0, 0)] });
	const h = await scanHistory(dir, now);
	assert.equal(h.today.entries.length, 1);
	assert.equal(h.today.entries[0].ok, false);
	assert.equal(h.today.input, 7);
});

test("scanHistory returns zeros for a missing root", async () => {
	const h = await scanHistory(join(tmpdir(), "ecologits-missing-" + Date.now()), now);
	for (const p of PERIODS) assert.deepEqual(h[p], { entries: [], input: 0, cacheRead: 0, cacheWrite: 0 });
});
