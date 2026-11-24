# EcoLogits upstream sync: pi agent fallback — design

**Intent:** Approach B from `2026-11-23-ecologits-upstream-sync-design.md`. When the scripted sync stops at needs-attention, let an agent handle the leftovers so the result is usually a reviewable PR instead of an issue. To be tried after the script-only workflow has proven itself.

**Goals**
- Agent runs only on needs-attention, only when `ANTHROPIC_API_KEY` is set; otherwise behaviour is identical to approach A.
- Agent scope: port upstream formula / `PROVIDER_CONFIG_MAP` changes into `llm.ts`; replace a vanished `reference/gen.py` case model.
- Deterministic gates after the agent: allowed-files guardrail, then the normal sync re-run (Python reference + tests).

**Non-goals:** Agent on every run. Agent editing tests, `data/`, or tolerances. Agent committing/pushing or calling GitHub. Auto-merge.

**Anti-goals:** A green PR produced by weakening tests. The agent holding a GitHub write token.

**Decided how**
- **Agent:** pi headless, `@earendil-works/pi-coding-agent@1.6.0`, `pi --print`, model from Actions variable `PI_MODEL` (default `anthropic/claude-sonnet-5-5`), `-ne --no-mcp -ns -np`, session saved to `$RUNNER_TEMP/pi-sessions` and uploaded as artifact `pi-session` (transcript + token usage). Prompt: `.github/agent/sync-prompt.md` + the sync report + upstream checkout path. 20-minute step timeout; `continue-on-error`.
- **Guardrail:** `git write-tree` snapshot before the agent; afterwards any changed path other than `llm.ts`, `reference/gen.py`, `reference/reference.json` → needs-attention with the list in the report.
- **Re-verify:** reset `data/` and `reference/reference.json` to HEAD, re-run `scripts/sync-upstream.ts --accept-code-changes` (new flag: upstream code diff stays in the report but is not a reason; the "data unchanged" early exit no longer applies when there is a code diff).
- **Outcome:** PR (title marks it agent-ported) or issue, with the agent's final message appended to the body.
- **Security:** checkout keeps `persist-credentials: false`; the agent step gets only `ANTHROPIC_API_KEY`; PR/issue steps run after it with `GITHUB_TOKEN`.

**Verified locally** (shell steps replayed, scripted edits standing in for the agent, upstream `3a8e85c → 4edff3e` with the removed `gpt-5-codex` case): agent fixes `gen.py` → synced, files identical to the committed refresh; agent touches `data/` → guardrail needs-attention; agent does nothing → needs-attention with the original reason. `--accept-code-changes` checked against upstream `9662516^ → 4edff3e` (formula change already ported): without flag needs-attention, with flag synced.

**Not verified:** a real pi run in Actions (needs the secret; costs tokens).
