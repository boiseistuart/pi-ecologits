# SDD ledger — plan: ~/.pi/agent/extensions/ecologits/docs/plans/2026-11-13-ecologits.md
Setup: Ruling: ~/.pi/agent/extensions is not a git repo — git init inside ecologits/ for commits, ledger beside plan (no-pronouns precedent) — cost if wrong: none, repo is local.
Pre-flight: T2 consumes computeLlmImpacts/Impacts/Range from T1 — consistent. T3 consumes estimate from T2 — consistent.
Task 1: Ruling: PROVIDER_CONFIG exported from llm.ts (plan put it nowhere explicit) — test and lookup both need it — none
Task 1: complete (commits 7f456a4..ec25bc6, tests: node --test llm.test.ts → 6/6 pass)
Task 2: Ruling: outputTokens<=0 returns zero impacts instead of Python's TTFT-only server energy — plan Review Focus 1 requires zero; output-token methodology attributes nothing — cost if wrong: aborted responses slightly undercounted
Task 2: Ruling: latency<=0 treated as unknown (Infinity, Python's default) — guards clock skew — none
Task 2: complete (commits ec25bc6..ddb3c09, tests: node --test → 15/15 pass)
Task 3: Ruling: /impact reads entries from the session (falls back to in-memory list) — keeps report consistent with persisted data — none
Task 3: complete (commits ddb3c09..5fbaaf5, tests: node --test → 21/21 pass; manual: pi -p persisted an ecologits-impact entry with real latency)
Final review: self-review (no subagent tool) — Review Focus 1–5 each covered by a test; no Critical/Important findings.
Final: minor (deferred): zero-impacts constant duplicated in lookup.ts and index.ts.
Final: minor (deferred): a message without a provider string would throw inside message_end (pi reports the handler error; session continues).
