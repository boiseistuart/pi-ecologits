"""Generate reference impacts from the Python EcoLogits library.

Run: uv run --with /tmp/ecologits python reference/gen.py
"""
import json
import os

from ecologits.tracers.utils import llm_impacts

CASES = [
    ("anthropic", "claude-opus-5-5", 500, 6.0),
    ("anthropic", "claude-haiku-4-5-20251001", 1, 0.3),
    ("openai", "gpt-5.3-codex", 2000, 40.0),
    ("openai", "gpt-5-2025-08-07", 800, 1.0),
    ("mistralai", "codestral-2508", 300, 5.0),
    ("huggingface_hub", "databricks/dolly-v1-6b", 1000, 1000.0),
]


def rng(v):
    v = v.value
    if hasattr(v, "min"):
        return {"min": v.min, "max": v.max}
    return {"min": v, "max": v}


out = []
for provider, model, tokens, latency in CASES:
    r = llm_impacts(provider, model, tokens, latency)
    out.append({
        "provider": provider, "model": model, "output": tokens, "latency": latency,
        "impacts": {
            "energy": rng(r.energy), "gwp": rng(r.gwp), "adpe": rng(r.adpe), "pe": rng(r.pe), "wcf": rng(r.wcf),
            "usage": {k: rng(getattr(r.usage, k)) for k in ("energy", "gwp", "adpe", "pe", "wcf")},
            "embodied": {k: rng(getattr(r.embodied, k)) for k in ("gwp", "adpe", "pe")},
        },
    })

with open(os.path.join(os.path.dirname(__file__), "reference.json"), "w") as f:
    json.dump(out, f, indent=1)
print(f"wrote {len(out)} cases")
