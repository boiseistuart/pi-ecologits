# EcoLogits upstream sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly GitHub Action syncs EcoLogits data from upstream, keeps removed models, verifies against Python EcoLogits, and opens a PR (success) or an issue (needs attention).

**Architecture:** Pure helpers in `scripts/merge.ts` (data merge) and `scripts/sync-lib.ts` (parsing, pin rewrite, report) are unit-tested. `scripts/sync-upstream.ts` orchestrates git, `uv`, and `node --test`, writes a report, and sets a `status` output. `.github/workflows/sync-upstream.yml` turns that status into a PR or an issue.

**Tech Stack:** Node 26 TypeScript (type stripping, no npm deps), `node --test`, `git`, `uv`, GitHub Actions (`actions/setup-node`, `astral-sh/setup-uv`, `peter-evans/create-pull-request`, `gh`).

**Spec:** `docs/specs/2026-11-23-ecologits-upstream-sync-design.md`

## Global Constraints

- Upstream: `https://github.com/genai-impact/ecologits.git`, branch `main`.
- Pin source of truth: `data/UPSTREAM`, one line, full 40-char SHA + `\n`. Text pins in `llm.ts` header and `README.md` use the first 7 chars. `docs/` is never rewritten.
- Merge rule: upstream wins for any key present upstream; local-only entries are kept. Keys: models `provider|name`, aliases `provider|name`, mixes `name`.
- Data files are written as `JSON.stringify(data, null, 4)` with **no** trailing newline (matches upstream bytes).
- Reference regenerated only via `uv run --with <upstream checkout> python reference/gen.py`.
- Tests are the gate: `node --test` must pass for status `synced`.
- `status` values: `up-to-date`, `synced`, `needs-attention`. Script exits 0 for all three; non-zero only on crashes.
- Report path default `sync-report.md` (gitignored); overridable with `--report`.
- No npm dependencies. No first-person pronouns in comments or commit messages.

## Review Focus

1. Retained model whose alias upstream re-points or drops: an upstream alias wins; a local-only alias is kept only if its target exists in the merged models. Test in Task 1.
2. Nothing removed upstream: merged output is byte-identical to upstream's file. Test in Task 1 (`mergeModels(u, u)` deep-equals `u`) and verified on real data in Task 4.
3. `gen.py` case model missing upstream (as `gpt-5-codex` was): status `needs-attention`, reason names the model, no reference regeneration. Test of `missingCases` in Task 2.
4. Text pin rewrite when the old short SHA is absent (hand-edited README): rewrite reports it rather than silently succeeding. Test in Task 2.
5. Re-running the workflow while a sync PR/issue is already open: updates the same PR/issue instead of creating another. Verified in Task 5 by design (fixed branch, label lookup).

---

### Task 1: Data merge

**Files:**
- Create: `scripts/merge.ts`
- Test: `scripts/merge.test.ts`

**Interfaces:**
- Produces:
  - `type ModelsFile = { aliases: Alias[]; models: Model[] }`, `type MixesFile = { electricity_mixes: Mix[] }` (fields beyond keys typed loosely)
  - `mergeModels(local: ModelsFile, upstream: ModelsFile): { data: ModelsFile; added: string[]; changed: string[]; retained: string[] }` — keys `provider/name`, sorted
  - `mergeMixes(local: MixesFile, upstream: MixesFile): { data: MixesFile; added: string[]; changed: string[]; retained: string[] }`
  - Output order: upstream entries in upstream order, then retained entries sorted by key.

- [ ] **Step 1: Write failing tests** in `scripts/merge.test.ts`:
  - `mergeModels keeps local-only models and lists them as retained` — local has `openai/gpt-4` + `openai/gpt-5`, upstream has `openai/gpt-5` (changed tps) + `openai/gpt-6`; assert `data.models` names = `["gpt-5","gpt-6","gpt-4"]`, upstream's `gpt-5` object used, `added=["openai/gpt-6"]`, `changed=["openai/gpt-5"]`, `retained=["openai/gpt-4"]`.
  - `mergeModels is identity when local equals upstream` — `deepEqual(mergeModels(u,u).data, u)` and all lists empty.
  - `mergeModels alias rules` — upstream alias `a→x` overrides local `a→y`; local-only alias `b→gpt-4` kept (target retained); local-only alias `c→gone` dropped (target in neither).
  - `mergeMixes keeps local-only zones; upstream values win` — CAF gwp 0 local / 0.024 upstream → 0.024, `changed=["CAF"]`; local-only `XXX` retained.
- [ ] **Step 2:** `node --test scripts/merge.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement in `scripts/merge.ts`. Compare entries with `JSON.stringify` for `changed`.
- [ ] **Step 4:** `node --test scripts/merge.test.ts` → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat: add upstream data merge that keeps removed models`.

### Task 2: Sync helpers

**Files:**
- Create: `scripts/sync-lib.ts`
- Test: `scripts/sync-lib.test.ts`

**Interfaces:**
- Produces:
  - `parseCases(genPy: string): { provider: string; model: string }[]` — tuples inside the `CASES = [...]` block.
  - `missingCases(cases, upstream: ModelsFile): string[]` — `provider/model` not found as model or alias.
  - `extractProviderConfig(utilsPy: string): string` — text from the line starting `PROVIDER_CONFIG_MAP = {` through the next line that is exactly `}`; `""` if absent.
  - `rewritePin(text: string, oldShort: string, newShort: string): { text: string; replaced: boolean }` — replaces every `@ \`${old}\`` and `@ ${old}` occurrence.
  - `formatReport(r: SyncReport): string` with `SyncReport = { status: "up-to-date"|"synced"|"needs-attention"; from: string; to: string; reasons: string[]; models?: MergeLists; mixes?: MergeLists; codeDiff?: string; testOutput?: string }` (`MergeLists` = `{added, changed, retained}`).

- [ ] **Step 1: Write failing tests** in `scripts/sync-lib.test.ts`:
  - `parseCases reads gen.py` — on the real `reference/gen.py`, returns 6 cases, first `{provider:"anthropic", model:"claude-opus-5-5"}`, includes `openai/gpt-5.3-codex`.
  - `missingCases finds removed and accepts aliases` — `openai/gpt-5-codex` missing; `anthropic/claude-haiku-4-5` (alias) not missing.
  - `extractProviderConfig` — on a fixture string with lines before, the block, and lines after, returns exactly the block (starts `PROVIDER_CONFIG_MAP = {`, ends `}`); returns `""` on text without it.
  - `rewritePin` — `"Source: …ecologits @ 3a8e85c"` → `@ 4edff3e`, `replaced: true`; README form ``@ `3a8e85c` `` → ``@ `4edff3e` ``; text without the old SHA → unchanged, `replaced: false`.
  - `formatReport` — contains `3a8e85c → 4edff3e` (short SHAs), a `Retained (removed upstream)` section listing retained keys, each reason as a bullet, and code diff / test output inside fenced blocks only when present.
- [ ] **Step 2:** `node --test scripts/sync-lib.test.ts` → FAIL.
- [ ] **Step 3:** Implement in `scripts/sync-lib.ts`.
- [ ] **Step 4:** `node --test scripts/sync-lib.test.ts` → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat: add upstream sync helpers`.

### Task 3: Orchestrator script and pin file

**Files:**
- Create: `scripts/sync-upstream.ts`, `data/UPSTREAM`, `.gitignore`
- Modify: `README.md` (short "Updating EcoLogits data" section)

**Interfaces:**
- Consumes: Task 1 `mergeModels`, `mergeMixes`; Task 2 helpers.
- Produces: CLI `node scripts/sync-upstream.ts [--upstream-dir <path>] [--ref <sha>] [--report <path>]`; writes `status=<value>` to `$GITHUB_OUTPUT` when set and prints it to stdout either way.

- [ ] **Step 1:** Create `data/UPSTREAM` containing the full SHA of upstream `4edff3e` (resolve with `git -C /tmp/ecologits rev-parse 4edff3e`). Create `.gitignore` with `sync-report.md`.
- [ ] **Step 2:** Implement `scripts/sync-upstream.ts` (paths relative to the repo root via `import.meta.url`):
  1. Read pin. Upstream dir: `--upstream-dir` (fetch `origin`) or fresh `git clone` into `os.tmpdir()`. Target = `--ref` or `origin/main`, resolved to full SHA.
  2. Pin == target → report `up-to-date`, exit 0.
  3. `codeDiff` = `git diff <pin>..<target> -- ecologits/impacts/llm.py` plus a note and the before/after `extractProviderConfig` blocks if they differ. Non-empty → add reason "Formula or provider config changed upstream — port into llm.ts".
  4. Checkout target. Merge local `data/*.json` with upstream `ecologits/data/*.json`; write per Global Constraints.
  5. `missingCases` non-empty → reason per model, status `needs-attention`, skip 6–7.
  6. `uv run --with <dir> python reference/gen.py`; non-zero exit → reason + output, `needs-attention`.
  7. `node --test` from repo root; non-zero → reason, `testOutput` = last 100 lines, `needs-attention`.
  8. On success: write `data/UPSTREAM`, `rewritePin` on `llm.ts` and `README.md` (`replaced: false` → reason, `needs-attention`). Status `synced` if no reasons, else `needs-attention`.
  9. Write report; print status.
- [ ] **Step 3:** Verify up-to-date path: `node scripts/sync-upstream.ts --upstream-dir /tmp/ecologits --ref 4edff3e` → prints `status=up-to-date`; `git status --short` shows only the new files from this task.
- [ ] **Step 4:** Add README section: what the weekly workflow does, how to run the script locally (needs `uv`), and that removed models are retained.
- [ ] **Step 5:** `npm test` → all pass. Commit `feat: add upstream sync script and pin file`.

### Task 4: Restore models removed by the 4edff3e refresh

**Files:**
- Modify: `data/models.json`, `data/electricity_mixes.json`, `reference/reference.json`, `data/UPSTREAM`

- [ ] **Step 1:** Put back the pre-refresh state: `git checkout fd08af9 -- data/models.json data/electricity_mixes.json`; write the full `3a8e85c` SHA to `data/UPSTREAM`; set the `llm.ts` and `README.md` pins back to `3a8e85c`.
- [ ] **Step 2:** Run `node scripts/sync-upstream.ts --upstream-dir /tmp/ecologits --ref 4edff3e` → `status=synced`; report lists 10 added, 40 retained, `CAF` changed under mixes.
- [ ] **Step 3:** Verify:
  - `git diff 1329a41 -- data/models.json` only adds retained entries (no upstream entry differs): `node -e` check that the first `upstream.models.length` entries deep-equal upstream's.
  - `data/electricity_mixes.json` byte-identical to upstream: `cmp data/electricity_mixes.json /tmp/ecologits/ecologits/data/electricity_mixes.json`.
  - `git diff --stat` shows `llm.ts` and `README.md` unchanged vs `1329a41`; `reference/reference.json` unchanged.
  - `node -e` check that `estimate("openai","gpt-5-codex",100,1).ok === true` via `lookup.ts`.
  - `npm test` → all pass.
- [ ] **Step 4:** Commit `fix: restore models removed upstream in 4edff3e`.

### Task 5: Scheduled workflow

**Files:**
- Create: `.github/workflows/sync-upstream.yml`

- [ ] **Step 1:** Write the workflow:
  - `on: schedule: cron "0 6 * * 1"` and `workflow_dispatch`. `permissions: contents: write, pull-requests: write, issues: write`. `concurrency: sync-upstream`.
  - Steps: `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: 26`; `astral-sh/setup-uv@v6`; `node scripts/sync-upstream.ts --report "$RUNNER_TEMP/sync-report.md"` (id `sync`).
  - `if: steps.sync.outputs.status == 'synced'` → `peter-evans/create-pull-request@v7`: `branch: sync/ecologits`, `delete-branch: true`, `title: "chore: sync EcoLogits data from upstream"`, `commit-message` same, `body-path: ${{ runner.temp }}/sync-report.md`, `add-paths` = `data/`, `reference/reference.json`, `llm.ts`, `README.md`.
  - `if: … == 'needs-attention'` → `gh` with `GH_TOKEN: ${{ github.token }}`: `gh label create upstream-sync --force`; find open issue `gh issue list --label upstream-sync --state open --json number -q '.[0].number'`; if found `gh issue edit <n> --body-file`, else `gh issue create --title "EcoLogits upstream sync needs attention" --label upstream-sync --body-file`.
- [ ] **Step 2:** Validate syntax: `npx --yes actionlint` if available, otherwise `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/sync-upstream.yml'))"` → no error.
- [ ] **Step 3:** Commit `ci: add weekly EcoLogits upstream sync workflow`.
- [ ] **Step 4 (needs partner's go-ahead):** Ask before pushing. After push: partner enables *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*; run `gh workflow run sync-upstream.yml`, then `gh run watch` → success with `status=up-to-date` in the log.
