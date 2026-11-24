# ecologits — environmental impact for pi

A pi extension that estimates the energy, carbon, and water footprint of each assistant response, using a TypeScript port of [EcoLogits](https://ecologits.ai) ([genai-impact/ecologits](https://github.com/genai-impact/ecologits) @ `3a8e85c`). No Python, no npm dependencies.

## What you see

**Footer** — running totals for the current session, as midpoint estimates with everyday equivalents:

```
⚡ ~12 Wh ≈ 📱 0.92 charges · ~5.1 gCO₂e ≈ 🚗 0.021 miles · ~48 mL ≈ 🥛 0.24 glasses
```

- Coloured green → red by progress toward per-session ceilings: **50 Wh**, **20 gCO₂e**, **200 mL** (whichever is closest). Ends with `‼` once a ceiling is reached.
- Equivalents: 13 Wh per smartphone charge, 240 gCO₂e per petrol-car mile, 200 mL per glass of water.
- Shows `n/a (<model>)` when the current model isn't in the EcoLogits data.

**`/impact`** — a detailed report:

1. *This session*: min–max ranges for energy, GWP, water, ADPe and primary energy, split into usage and embodied; responses and output tokens per model; EcoLogits warnings.
2. *All sessions*: totals for **Today**, **This week** (Monday start), **This month**, **This year** and **All time**, in local time:

```
All sessions
            Energy    GWP          Water   Responses  Output  Input  Cache read  Cache write
Today       ~1.6 kWh  ~646 gCO₂e   ~6.1 L  685        410k    2.5M   82M         1.9M
...
All time    ~8.7 kWh  ~3.5 kgCO₂e  ~33 L   3241       2.3M    2.7M   280M        15M
```

## What is (and isn't) counted

- **Output tokens only.** EcoLogits models generation, not prompt/context processing. Input and cache tokens are shown for context but never converted to impact, so figures likely **understate** the real footprint — in agent sessions, cache reads can outnumber output tokens by ~100×.
- **Unknown models** (not in the EcoLogits data, e.g. local MLX models) still count toward responses and token columns, but contribute zero energy/GWP/water. The session report marks them "not estimated".
- **Not recorded:** responses from before the extension was installed, compaction summaries, and cache-warm usage.
- Ranges reflect EcoLogits' uncertainty (data-centre PUE/WUE, latency-based GPU estimates). The footer and all-sessions table show midpoints.

## How it works

- On each assistant `message_end`, the extension maps pi's provider/model to EcoLogits, computes impacts from output tokens and latency, and stores the result in the session file as a custom `ecologits-impact` entry. Session totals therefore survive resume and reload.
- `/impact`'s all-sessions table scans every `*.jsonl` under the sessions root (default `~/.pi/agent/sessions/`; a custom `sessionDir` is honoured). Responses copied by `/fork`, `/clone` or `--fork` are counted once (deduped on entry id + timestamp). Input/cache tokens come from the assistant message that follows each impact entry. Nothing extra is stored; deleting a session removes it from the totals.

### Provider mapping

| pi provider | EcoLogits provider |
|---|---|
| `anthropic`, `anthropic-*` | `anthropic` |
| `openai`, `openai-*`, `azure-openai*` | `openai` |
| `google`, `google-*`, `gemini` | `google_genai` |
| `mistral`, `mistralai` | `mistralai` |
| `cohere` | `cohere` |
| `huggingface` | `huggingface_hub` |

For other providers (e.g. OpenRouter), a model id of the form `vendor/name` is mapped by its `vendor` prefix.

## Files

| Path | Purpose |
|---|---|
| `index.ts` | Extension wiring: footer, `/impact`, report formatting |
| `history.ts` | Cross-session scan, dedupe, period bucketing |
| `lookup.ts` | pi → EcoLogits provider/model mapping, `estimate()` |
| `llm.ts` | Port of EcoLogits' `compute_llm_impacts` |
| `data/` | EcoLogits `models.json` and `electricity_mixes.json` snapshots |
| `reference/` | `gen.py` and `reference.json`: outputs from the Python library used to verify the port |
| `docs/specs/`, `docs/plans/` | Design docs and implementation plans |

## Install

```bash
pi install git:github.com/<you>/pi-ecologits
```

Pin a version with `@<tag>`, e.g. `git:github.com/<you>/pi-ecologits@v0.1.0`. Then `/reload` in pi (or restart).

Alternatively, clone this repo to `~/.pi/agent/extensions/ecologits/`. Pi loads extensions from there automatically. Use one method, not both, or the extension loads twice.

`package.json` limits loading to `index.ts`; the other modules are imported by it, and test files are never loaded.

## Development

Requires Node 26+ (native TypeScript type stripping).

```bash
node --test   # or: npm test
```

To regenerate reference values from the Python library (with an EcoLogits checkout at `/tmp/ecologits`):

```bash
uv run --with /tmp/ecologits python reference/gen.py
```

To update model data, copy `models.json` and `electricity_mixes.json` from the EcoLogits repo into `data/` and re-run the tests.
