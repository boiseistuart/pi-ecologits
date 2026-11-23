# SDD ledger — plan: ~/.pi/agent/extensions/ecologits/docs/plans/2026-11-16-ecologits-footer-ceiling.md
Pre-flight: no shared interfaces (single task)
Ruling: no git repo — backups in /tmp/ecologits-backup, ledger here instead of commits — cost if wrong: none
Task 1: Ruling: CEILING stored in display units { energyWh: 50, gwpG: 20, waterMl: 200 } instead of plan's base units — avoids float error at exact boundaries (0.15/0.2 ≠ 0.75) — cost if wrong: none, same values
Task 1: complete (tests: node --test → 26/26 pass; RED observed: missing export ceilingProgress)
Final review: self-review (no subagent tool). Verified real theme.style + foregroundAnsi emit truecolor/256 ANSI for literal rgb; footer only strips \r\n\t so ANSI survives.
Final: minor (deferred): ‼ is last on the extension status line only while no other extension with a key sorting after "ecologits" sets a status (none currently do)
