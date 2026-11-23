# EcoLogits /impact: cross-session running totals — design

**Intent:** See cumulative estimated impact beyond the current session — today, this week, this month, this year, all time — from the `/impact` command. Initially `/impact` only; other surfaces (footer, export) may follow later.

**Goals**
- `/impact` keeps its current per-session report and adds an "all sessions" table: rows Today / This week / This month / This year / All time; columns Energy, GWP, Water (midpoints, same units/formatting as the footer), responses, output tokens, input tokens, cache-read tokens, cache-write tokens.
- Periods are calendar periods in local time; weeks start Monday.
- Existing history counts: totals are computed from all `ecologits-impact` entries already in session files.
- The output-tokens-only caveat stays, now backed by the input/cache token columns showing what isn't counted.

**Non-goals:** Estimating impact of input/cache tokens (chosen: option 1, counts only). Footer changes, export, configurable periods, rolling windows, caching.

**Anti-goals:** Double-counting responses copied by `/fork`, `/clone`, `--fork`. Introducing a second store that can drift from session files.

**Constraints**
- Session files: `~/.pi/agent/sessions/**/*.jsonl` by default; honour `PI_CODING_AGENT_SESSION_DIR` / `sessionDir` if resolvable (otherwise default dir). Current size: 146 files, 40 MB; text scan ~0.4 s.
- Entry timestamps are ISO 8601 (`entry.timestamp`); entry IDs are 8-hex and not globally unique, so dedupe on `id + timestamp`.
- Malformed lines/files are skipped, never fatal.

**Approaches**
- **A. Scan session files on each `/impact` (chosen).** No new storage; session files remain the source of truth; simple to test with fixture files. Cost grows with history (~1 s per 100 MB); deleting a session removes it from all-time.
- B. Global ledger appended on each response, plus backfill. Fast at any scale, survives session deletion, but duplicates the source of truth, needs backfill and its own dedupe. Rejected: drift and extra machinery.
- C. A plus per-file mtime cache. Rejected for now: solves a speed problem that doesn't exist yet; can be added later without visible change.

**Decided how**
- New module `history.ts`: find session files, stream lines, keep `custom`/`ecologits-impact` entries (impacts, output, response count) and assistant `message` entries (`usage.input`, `cacheRead`, `cacheWrite`), dedupe by `id + timestamp`, bucket by period relative to "now" (injectable for tests).
- Pure formatting function for the table in `index.ts` (or `history.ts`), reusing `sumImpacts`, `approx`, unit tables.
- `/impact` output: existing session report, blank line, all-sessions table, caveat once at the end.

**Left to the builder:** File discovery details, exact column widths/number formatting for token counts (e.g. `1.2M`), whether reading is sync or async (async preferred so the UI isn't blocked).
