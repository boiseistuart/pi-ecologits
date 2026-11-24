/**
 * Sync data/ with upstream EcoLogits and verify against the Python library.
 *
 *   node scripts/sync-upstream.ts [--upstream-dir <path>] [--ref <sha>] [--report <path>]
 *
 * Prints `status=<up-to-date|synced|needs-attention>` (also written to
 * $GITHUB_OUTPUT when set) and writes a Markdown report. Exits non-zero only
 * on unexpected errors. Requires git, uv and node on PATH.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { mergeMixes, mergeModels } from "./merge.ts";
import {
	extractProviderConfig,
	formatReport,
	missingCases,
	parseCases,
	rewritePin,
	serializeData,
	type SyncReport,
} from "./sync-lib.ts";

const UPSTREAM_URL = "https://github.com/genai-impact/ecologits.git";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const root = (p: string) => join(ROOT, p);

const { values: args } = parseArgs({
	options: {
		"upstream-dir": { type: "string" },
		ref: { type: "string", default: "origin/main" },
		report: { type: "string", default: root("sync-report.md") },
	},
});

function run(cmd: string, argv: string[], cwd = ROOT): { code: number; out: string } {
	const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (r.error) throw r.error;
	return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function git(dir: string, ...argv: string[]): string {
	const r = run("git", ["-C", dir, ...argv]);
	if (r.code !== 0) throw new Error(`git ${argv.join(" ")} failed:\n${r.out}`);
	return r.out;
}

const tail = (s: string, n: number) => s.trimEnd().split("\n").slice(-n).join("\n");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function finish(report: SyncReport): never {
	writeFileSync(args.report!, formatReport(report));
	const line = `status=${report.status}`;
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
	console.log(line);
	console.log(`report: ${args.report}`);
	process.exit(0);
}

// 1. Pin and upstream target
const pin = readFileSync(root("data/UPSTREAM"), "utf8").trim();
let dir = args["upstream-dir"];
if (dir) git(dir, "fetch", "-q", "origin");
else {
	dir = join(mkdtempSync(join(tmpdir(), "ecologits-")), "ecologits");
	git(ROOT, "clone", "-q", UPSTREAM_URL, dir);
}
const target = git(dir, "rev-parse", "--verify", `${args.ref}^{commit}`).trim();
const report: SyncReport = { status: "synced", from: pin, to: target, reasons: [] };

// 2. Nothing to do
if (pin === target) finish({ ...report, status: "up-to-date" });

// 3. Upstream code changes (reported; the tests are the gate)
if (run("git", ["-C", dir, "cat-file", "-e", `${pin}^{commit}`]).code !== 0) {
	report.reasons.push(`Pinned commit ${pin.slice(0, 7)} not found upstream — code changes could not be diffed`);
} else {
	const parts: string[] = [];
	const llmDiff = git(dir, "diff", pin, target, "--", "ecologits/impacts/llm.py").trimEnd();
	if (llmDiff) parts.push(llmDiff);
	const utils = (sha: string) => extractProviderConfig(git(dir!, "show", `${sha}:ecologits/tracers/utils.py`));
	const [before, after] = [utils(pin), utils(target)];
	if (before !== after) {
		const tmp = mkdtempSync(join(tmpdir(), "pcm-"));
		writeFileSync(join(tmp, "before"), `${before}\n`);
		writeFileSync(join(tmp, "after"), `${after}\n`);
		const d = run("git", ["diff", "--no-index", "--", join(tmp, "before"), join(tmp, "after")]).out.trimEnd();
		parts.push(`# PROVIDER_CONFIG_MAP (ecologits/tracers/utils.py)\n${d}`);
	}
	if (parts.length) {
		report.codeDiff = parts.join("\n\n");
		report.reasons.push("Formula or provider config changed upstream — port into llm.ts");
	}
}

// 4. Merge data
git(dir, "checkout", "-q", "--detach", target);
const modelsRaw = readFileSync(join(dir, "ecologits/data/models.json"), "utf8");
const mixesRaw = readFileSync(join(dir, "ecologits/data/electricity_mixes.json"), "utf8");
const upstreamModels = JSON.parse(modelsRaw);
const models = mergeModels(readJson(root("data/models.json")), upstreamModels);
const mixes = mergeMixes(readJson(root("data/electricity_mixes.json")), JSON.parse(mixesRaw));
const nextModels = serializeData(models.data, modelsRaw);
const nextMixes = serializeData(mixes.data, mixesRaw);

// No data change and nothing to flag: leave the pin where it is, so commits
// without data changes don't produce pin-only PRs. Later runs still diff
// upstream code from this pin.
const dataUnchanged =
	nextModels === readFileSync(root("data/models.json"), "utf8") &&
	nextMixes === readFileSync(root("data/electricity_mixes.json"), "utf8");
if (dataUnchanged && !report.reasons.length) finish({ ...report, status: "up-to-date" });

writeFileSync(root("data/models.json"), nextModels);
writeFileSync(root("data/electricity_mixes.json"), nextMixes);
report.models = { added: models.added, changed: models.changed, retained: models.retained };
report.mixes = { added: mixes.added, changed: mixes.changed, retained: mixes.retained };

// 5. Reference cases must still exist upstream
const missing = missingCases(parseCases(readFileSync(root("reference/gen.py"), "utf8")), upstreamModels);
for (const m of missing) report.reasons.push(`Reference case model \`${m}\` no longer exists upstream — pick a replacement in reference/gen.py`);

if (!missing.length) {
	// 6. Regenerate reference with Python EcoLogits
	const gen = run("uv", ["run", "--no-project", "--reinstall-package", "ecologits", "--with", dir, "python", "reference/gen.py"]);
	if (gen.code !== 0) {
		report.reasons.push("Reference generation failed (reference/gen.py)");
		report.testOutput = tail(gen.out, 100);
	} else {
		// 7. Tests are the gate
		const tests = run("node", ["--test"]);
		if (tests.code !== 0) {
			report.reasons.push("Tests failed against the regenerated reference");
			report.testOutput = tail(tests.out, 100);
		}
	}
}

// 8. Bump the pin only when everything verified
if (!report.reasons.length) {
	writeFileSync(root("data/UPSTREAM"), `${target}\n`);
	for (const f of ["llm.ts", "README.md"]) {
		const r = rewritePin(readFileSync(root(f), "utf8"), pin.slice(0, 7), target.slice(0, 7));
		if (r.replaced) writeFileSync(root(f), r.text);
		else report.reasons.push(`Pin ${pin.slice(0, 7)} not found in ${f} — update it by hand`);
	}
}

finish({ ...report, status: report.reasons.length ? "needs-attention" : "synced" });
