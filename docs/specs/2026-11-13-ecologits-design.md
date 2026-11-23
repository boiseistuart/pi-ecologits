# EcoLogits impact display for pi — design (short)

**Intent:** awareness. Show the estimated environmental impact of the current pi session while working, using the EcoLogits methodology.

**Goals**
- Footer status with running session totals as midpoint estimates, e.g. `⚡ ~14 Wh · ~5 gCO₂e · ~30 mL`.
- `/impact` command: session totals as min–max ranges for energy (kWh), GWP (kgCO₂eq), water (L), ADPe (kgSbeq), PE (MJ), split usage/embodied; per-model response counts; EcoLogits warnings; the output-tokens-only caveat.
- Totals survive resume/reload (persisted per response with `pi.appendEntry`).

**Non-goals:** cross-session reporting/export; input-token (prefill) estimation; a Python dependency.
**Anti-goal:** inventing numbers. Unknown models show `⚡ n/a (<model>)`, never a guess.

**Approaches considered**
1. Shell out to the Python `ecologits` package: exact and auto-updating, but needs Python and adds per-response overhead.
2. **Port the formula to TypeScript (chosen by user):** no runtime deps; data and formula must be re-synced by hand.

**Design**
- Location: `~/.pi/agent/extensions/ecologits/` (`index.ts` wiring, `llm.ts` formula port, `data/models.json` + `data/electricity_mixes.json` snapshot from github.com/genai-impact/ecologits @ 3a8e85c).
- Inputs per assistant `message_end`: `message.provider`, `message.model`, `message.usage.output`, latency = `Date.now() - message.timestamp` (seconds).
- Formula: faithful port of `ecologits/impacts/llm.py` `compute_llm_impacts` + `tracers/utils.py` `llm_impacts` (same constants, PROVIDER_CONFIG_MAP, range semantics, model aliases, tps/ttft deployment data).
- Provider mapping pi → EcoLogits: `anthropic`→`anthropic`, `openai`/`openai-codex`/`azure-openai*`→`openai`, `google`/`google-*`→`google_genai`, `mistral`→`mistralai`, `cohere`→`cohere`; for any provider, a model id `vendor/name` (e.g. OpenRouter) strips the prefix and maps `vendor` the same way.
- Verified against the Python library on sample inputs.

**Left to the builder:** number formatting/unit scaling, exact footer wording beyond the example.
