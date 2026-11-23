# EcoLogits footer: everyday equivalents — design

**Intent:** Make the footer's impact numbers relatable by showing an everyday equivalent beside each one.

**Design**
- Each footer value is followed by ` ≈ <emoji> <n> <unit>`:
  `⚡ ~12 Wh ≈ 📱 0.92 charges · ~5.1 gCO₂e ≈ 🚗 0.021 miles · ~48 mL ≈ 🥛 0.24 glasses ‼`
- Conversion factors (a constant next to `CEILING`): 13 Wh per smartphone charge; 240 gCO₂e per petrol-car mile (~150 g/km); 200 mL per glass of water. Each is computed from the same midpoint the footer already shows.
- Numbers use the footer's existing `num()` formatting (two significant figures), so small values stay readable (e.g. `0.021 miles` rather than `0.0`).
- Units are always plural: `charges`, `miles`, `glasses`.
- Colour: source numbers keep the gauge colour. Each ` ≈ … unit` segment uses the same hue in a softer tone, with lower saturation and brightness. The tone is tuned for both dark and light `theme.appearance`.
- `‼` stays last on the line, in the gauge colour, after the last equivalent or after any `n/a (model)` note.
- No known estimates (`anyKnown` false): no equivalents, as today.

**Approaches considered**
- Softer tone: (1) compute a softened RGB of the gauge hue, *chosen* because it looks consistent across terminals and is testable. (2) ANSI faint attribute, rejected because terminal support is uneven and it isn't exposed by `theme.style`.
- Separator: parentheses rejected by the user. Options considered were `≈`, space only, `→`, `/`, and space with a `│` group divider. `≈` *chosen* because it states the relationship and pairs with the existing `~`.

**Constraints:** No npm runtime dependencies. Colours are passed as literal `{ kind: "rgb", … }` to `theme.style()`. Colour is skipped when `ctx.ui.theme` is unavailable. No first-person pronouns in comments.

**Left to the builder:** the exact softening amounts. Also how `formatFooter` returns segments so that `refresh` can colour them separately; `formatFooter` must still return a plain string for tests and the no-theme path.

**Non-goals:** Configurable factors, region-specific car or grid figures, changes to `/impact`.
