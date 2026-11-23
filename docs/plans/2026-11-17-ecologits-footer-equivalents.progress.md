# SDD ledger — plan: ~/.pi/agent/extensions/ecologits/docs/plans/2026-11-17-ecologits-footer-equivalents.md
Ruling: ledger kept beside the plan (matches prior ecologits plans) instead of .superpowers/sdd — cost if wrong: none
Ruling: work committed directly on main — personal extension repo, all prior commits on main, user said "Continue" — cost if wrong: commits easy to move/revert
Pre-flight: no shared interfaces (Task 0 is a commit only)
Task 0: complete (commit 9d47118, tests: node --test → pass)
Task 1: Ruling: added test "no theme: status equals the plain formatFooter string" for Review Focus #5 — plan named it but gave no code — cost if wrong: none
Task 1: Ruling: soft tone s=0.45, v=0.65 dark / 0.8 light (plan suggested 0.85 light; 0.8 keeps yellow legible on white while still paler than main 0.7) — cost if wrong: cosmetic, one-line tweak
Task 1: complete (commits 9d47118..1d3fd3a, tests: node --test → 31/31 pass; RED observed: missing export footerSegments)
Final review: self-review (no subagent tool). No Critical/Important findings; segments join to exactly formatFooter(); n/a-only path unchanged ("⚡ n/a (x)").
Final: minor (deferred): footer is ~50 chars longer; narrow terminals may truncate the status line
Final: minor (deferred): units always plural, so exactly 1 shows "1 charges" (per spec)
