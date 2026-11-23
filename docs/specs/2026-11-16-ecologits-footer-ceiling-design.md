# EcoLogits footer: session ceiling gauge — design

**Intent:** Make the session's cumulative impact visible at a glance, so the user can keep a session under a self-chosen per-session budget.

**Behavior**
- Per-session ceilings (constants in `index.ts`): energy 50 Wh, GWP 20 gCO₂e, water 200 mL.
- Progress `p = min(1, max(energy/50 Wh, gwp/20 g, water/200 mL))`, using the midpoints the footer already shows.
- The whole ecologits footer segment is coloured by hue `120° × (1 − p)`: green at 0, through yellow/orange, red at or above the ceiling. Brightness adapts to `theme.appearance` (dark vs light) so yellow stays legible.
- At `p ≥ 1`, append ` ‼` (U+203C, text-style glyph) as the last item on the line, after the water value or after any `n/a (model)` note.
- No known estimates (`anyKnown` false): no colour, no `‼`.

```
⚡ ~48 Wh · ~19 gCO₂e · ~170 mL     (green→red)
⚡ ~52 Wh · ~21 gCO₂e · ~190 mL ‼   (red)
```

**Approaches considered**
- Gauge metric: max of the three ratios (chosen; any number over budget shows red) vs. CO₂e only vs. average.
- Ceiling marker: ⚠ ♨ ☀ ☢ ⚑ 🔥 considered; ‼ chosen by the user. Colour emoji rejected because they ignore the text colour; ⚡ stays unchanged (no U+FE0F) so it picks up the gauge colour.

**Constraints:** No npm runtime dependencies; colour passed as a literal `{ kind: "rgb", r, g, b }` to `ctx.ui.theme.style()`, which handles truecolor/256-color fallback. Colour is skipped when `ctx.ui.theme` is unavailable. No first-person pronouns in comments.

**Non-goals:** Configurable ceilings, daily budgets, notifications.
