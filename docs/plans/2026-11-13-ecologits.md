# EcoLogits Impact Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pi extension that estimates per-response environmental impact with a TypeScript port of EcoLogits, shows session totals in the footer, and details them via `/impact`.

**Architecture:** `llm.ts` is a pure port of EcoLogits' formula (ranges as `{min,max}`). `lookup.ts` maps pi provider/model ids to EcoLogits data and calls `llm.ts`. `index.ts` wires pi events, persistence, footer and command.

**Tech Stack:** TypeScript run by pi directly; tests with `node --test` (Node 26 type stripping); `uv` + local EcoLogits clone only to generate reference values.

**Spec:** `~/.pi/agent/extensions/ecologits/docs/specs/2026-11-13-ecologits-design.md`

## Global Constraints
- Directory: `~/.pi/agent/extensions/ecologits/`; no npm dependencies; only type imports from `@earendil-works/pi-coding-agent`.
- Data snapshot: genai-impact/ecologits @ 3a8e85c (`ecologits/data/models.json`, `ecologits/data/electricity_mixes.json`), copied verbatim into `data/`.
- Constants, PROVIDER_CONFIG_MAP and formulas copied verbatim from `ecologits/impacts/llm.py` and `ecologits/tracers/utils.py` at that commit.
- Unknown models: never estimated; footer `⚡ n/a (<model>)`.
- Custom entry type: `"ecologits-impact"`.
- No first-person pronouns in comments or user-facing text.

## Review Focus
1. Response with `usage.output === 0` (aborted/errored): contributes zero impact, no crash.
2. Model ID with a date suffix or alias (e.g. `gpt-5-2025-08-07`) or OpenRouter `anthropic/claude-opus-5-5`: resolves via aliases / prefix stripping.
3. Session resumed after `/reload`: footer totals equal the sum of persisted entries, not zero.
4. Session mixing a known and an unknown model: footer shows known totals plus the `n/a` marker only while the *current* response's model is unknown; `/impact` lists the unknown model with count and "not estimated".
5. Model without deployment tps/ttft (e.g. `gpt-5-codex`): falls back to the latency regression, matching Python.

---

### Task 1: Formula port (`llm.ts`) verified against Python

**Files:**
- Create: `data/models.json`, `data/electricity_mixes.json` (copies), `llm.ts`, `llm.test.ts`, `reference/gen.py`, `reference/reference.json`

**Interfaces:**
- Produces:
  - `type Range = { min: number; max: number }`; `type VR = number | Range`
  - `interface Impacts { energy: Range; gwp: Range; adpe: Range; pe: Range; wcf: Range; usage: { energy: Range; gwp: Range; adpe: Range; pe: Range; wcf: Range }; embodied: { gwp: Range; adpe: Range; pe: Range } }` (all normalised to Range; scalar → min=max)
  - `computeLlmImpacts(p: { activeParams: VR; totalParams: VR; outputTokens: number; requestLatency?: number; mix: { gwp: number; adpe: number; pe: number; wue: number }; pue: VR; wue: VR; tps?: number | null; ttft?: number | null }): Impacts`

- [ ] **Step 1:** Write `reference/gen.py` (run with `uv run --with /tmp/ecologits python reference/gen.py`) that calls `ecologits.tracers.utils.llm_impacts` for these cases and dumps `{provider, model, output, latency, impacts(min/max per field)}` to `reference/reference.json`:
  `(anthropic, claude-opus-5-5, 500, 6.0)`, `(anthropic, claude-haiku-4-5-20251001, 1, 0.3)`, `(openai, gpt-5-codex, 2000, 40.0)`, `(openai, gpt-5-2025-08-07, 800, 1.0)`, `(mistralai, <first mistralai model in data>, 300, 5.0)`, `(huggingface_hub, <first dense hf model>, 1000, 1000.0)`.
- [ ] **Step 2:** Write `llm.test.ts`: for each reference case, call `computeLlmImpacts` with params taken from `data/*.json` + the PROVIDER_CONFIG values, assert every min/max field within relative 1e-9 of Python.
- [ ] **Step 3:** Run `node --test llm.test.ts` → FAIL (module missing).
- [ ] **Step 4:** Implement `llm.ts`. Mirror Python exactly: two scalar DAG runs (min params, max params) when either param count is a range, then combine field-wise as Python does; PUE/WUE ranges propagate with RangeValue add/mul semantics (min⊗min, max⊗max); `requestLatency` undefined → `Infinity`; `gpu_required_count` rounds up to a power of two.
- [ ] **Step 5:** Run `node --test llm.test.ts` → PASS.

### Task 2: Lookup and provider mapping (`lookup.ts`)

**Files:** Create `lookup.ts`, `lookup.test.ts`

**Interfaces:**
- Consumes: `computeLlmImpacts`, `Impacts`, `Range` from `llm.ts`
- Produces:
  - `mapProvider(piProvider: string, modelId: string): { provider: string; model: string } | null`
  - `estimate(piProvider: string, modelId: string, outputTokens: number, latencySec: number): { ok: true; impacts: Impacts; warnings: string[] } | { ok: false; reason: string }`

- [ ] **Step 1:** Tests:
  - `mapProvider("anthropic","claude-opus-5-5")` → `{provider:"anthropic",model:"claude-opus-5-5"}`
  - `mapProvider("openai-codex","gpt-5.3-codex")` → provider `"openai"`
  - `mapProvider("openrouter","anthropic/claude-opus-5-5")` → `{provider:"anthropic",model:"claude-opus-5-5"}`
  - `mapProvider("google","gemini-x")` → provider `"google_genai"`; `mapProvider("llama-cpp","qwen")` → `null`
  - `estimate("anthropic","claude-opus-5-5",500,6.0)` deep-equals the Task 1 reference impacts; `warnings` contains `"model-arch-not-released"`
  - `estimate("openai","gpt-5-2025-08-07",800,1.0)` resolves (alias or direct entry)
  - `estimate("anthropic","claude-opus-5-5",0,1.0).impacts.energy` → `{min:0,max:0}` (Review Focus 1)
  - `estimate("anthropic","no-such-model",10,1).ok === false`
- [ ] **Step 2:** Run `node --test lookup.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Load JSON via `readFileSync(new URL("./data/…", import.meta.url))`; build lookup including `aliases`; warnings = model warnings + electricity-mix warnings (codes).
- [ ] **Step 4:** Run `node --test` → all PASS.

### Task 3: Pi wiring (`index.ts`)

**Files:** Create `index.ts`, `index.test.ts`

**Interfaces:**
- Consumes: `estimate` from `lookup.ts`, `Impacts`/`Range` from `llm.ts`
- Produces: default export `(pi: ExtensionAPI) => void`; entry data `{ provider: string; model: string; output: number; latency: number; ok: boolean; impacts?: Impacts; warnings?: string[] }`; exported pure helpers `sumImpacts(entries): Impacts`, `formatFooter(total: Impacts, unknownCurrent?: string): string`, `formatReport(entries): string`.

- [ ] **Step 1:** Tests with a fake `pi`/`ctx` (pattern: `../no-pronouns/index.test.ts`):
  - `message_end` with an assistant message (`provider:"anthropic"`, `model:"claude-opus-5-5"`, `usage.output:500`, `timestamp: Date.now()-6000`) → `appendEntry("ecologits-impact", data)` called once with `ok:true`, and `setStatus("ecologits", s)` where `s` matches `/^⚡ ~.* Wh · ~.* gCO₂e · ~.* mL$/`.
  - User / toolResult `message_end` → no entry.
  - Unknown model → entry with `ok:false`; status contains `n/a (no-such-model)`.
  - `session_start` with `ctx.sessionManager.getEntries()` returning two persisted `ecologits-impact` custom entries → status reflects their sum (Review Focus 3).
  - `formatReport` output contains `Energy`, `GWP`, `Water`, `ADPe`, `PE`, `usage`, `embodied`, each model with its response count, unknown models marked `not estimated`, and the line `Note: EcoLogits counts output tokens only; prompt/context processing is not included, so figures likely understate impact.`
- [ ] **Step 2:** Run `node --test index.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Footer uses midpoints `(min+max)/2`, energy shown in Wh, GWP in g, water in mL (scale to k-/units when large). `/impact` via `pi.registerCommand("impact", …)` showing `formatReport` with `ctx.ui.notify` (or an info message when no UI). Footer status cleared only on `session_shutdown`.
- [ ] **Step 4:** Run `node --test` in the extension dir → all PASS.
- [ ] **Step 5:** Manual check: `/reload` in pi, send one prompt, confirm footer appears and `/impact` prints the report.
