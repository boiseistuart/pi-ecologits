# EcoLogits upstream sync (scheduled GitHub Action) — design

**Intent:** Keep up with new models in upstream EcoLogits without manual refreshes. Script as much as possible; a human (later possibly an agent) handles only what the script can't.

**Goals**
- Weekly (and on-demand) check of `genai-impact/ecologits` `main` against the pinned commit.
- When upstream data changed and everything verifies: open (or update) a PR with refreshed data, regenerated reference and bumped pin, ready to merge.
- When the script can't finish (tests fail, formula/provider config changed, a reference case model disappeared): open (or update) an issue with the reason and relevant upstream diff.

**Non-goals:** Agent fallback (approach B — later). Auto-merging. Porting formula changes automatically. Changing `index.ts`/`lookup.ts` behaviour.

**Anti-goals:** Silently dropping models users still run (upstream removed 40 in the last refresh). Duplicate PRs/issues piling up week after week. A green PR whose estimates don't match Python EcoLogits.

**Constraints**
- Repo is public (`boiseistuart/pi-ecologits`, default `main`); no CI exists yet. Node ≥26, no npm deps; tests are `node --test`.
- `reference/reference.json` must come from real Python EcoLogits (`uv run --with <upstream checkout> python reference/gen.py`).
- `llm.test.ts` checks the TS port (constants + `PROVIDER_CONFIG`) against that reference, so formula or provider-config changes upstream show up as test failures.
- Upstream cadence (last 12 months): ~19 data commits, 6 `llm.py` commits, 3 `tracers/utils.py` commits.
- Actions must be allowed to create PRs (repo setting: *Allow GitHub Actions to create and approve pull requests*).

**Approaches**
- **A. Script + PR, no agent (chosen).** Deterministic, free; leftovers become an issue for a human.
- B. A plus agent fallback (pi headless or `claude-code-action`) on the leftovers. Deferred: ~$5–15/yr, add once A has run for a while.
- C. Agent does everything weekly. Rejected: ~$30–100/yr, nondeterministic.

**Decided how**
- **Pin file:** `data/UPSTREAM` holds the pinned upstream commit SHA (single source of truth). The script also rewrites the SHA in the `llm.ts` header and `README.md`. Historical docs in `docs/` are left alone.
- **Sync script:** `scripts/sync-upstream.ts` (Node, no deps), runnable locally too. Steps:
  1. Read pin; resolve upstream `main` HEAD. Same → exit "up to date".
  2. Clone upstream; collect `git diff <pin>..HEAD` for `ecologits/impacts/llm.py` and the `PROVIDER_CONFIG_MAP` block of `ecologits/tracers/utils.py` (for reporting only — tests are the gate).
  3. **Merge data:** `models.json` = upstream models/aliases, plus local entries upstream removed (kept as-is; upstream wins on anything present in both). `electricity_mixes.json` = same rule per zone.
  4. Check every `reference/gen.py` case model exists upstream; if not, fail with that reason.
  5. Regenerate `reference/reference.json`, run `npm test`.
  6. Bump pin (file + `llm.ts` + `README.md`).
  7. Write `sync-report.md`: old→new SHA, models added / changed / removed-but-retained, mix changes, code-diff excerpts, and outcome. Exit status signals success vs needs-attention.
- **Workflow:** `.github/workflows/sync-upstream.yml`, `schedule` weekly (Mon) + `workflow_dispatch`. Ubuntu, Node 26, `uv`. Permissions: `contents`, `pull-requests`, `issues` write.
  - Success → `peter-evans/create-pull-request` on fixed branch `sync/ecologits` (updates the same PR), body = report.
  - Needs attention → create or update a single open issue labelled `upstream-sync`, body = report + test output.
  - Up to date → nothing.
- `gen.py` case list stays hand-picked (tests reference `claude-opus-5-5` by name); a vanished case model is reported, not auto-replaced. *(Changed from my earlier suggestion: auto-picking would ripple into `lookup.test.ts`, and it happens ~once a year.)*

**Left to the builder:** Report formatting; how the script finds the `PROVIDER_CONFIG_MAP` block; exact cron time; unit tests for the merge function (expected); whether the script shells out to `git` or uses the GitHub API for the HEAD SHA.
