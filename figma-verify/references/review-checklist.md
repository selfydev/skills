# Review checklist (slice 2)

Named pass/fail checks for the screenshot review. Run each as a deliberate
check, not a vibe. Pair the visual read with the structural snapshot
(`summarize-node.js`) and the bounds check (`check-bounds.js`) so a node that
*looks* fine but is off-token is still caught, and a node that *looks* off but
is correct isn't flagged.

## Capture

- Use `figma_capture_screenshot` (plugin `exportAsync`, live state) with the
  changed node's id. Scale 1 is usually enough; the plugin auto-caps the longest
  side at 1568px. Bump scale only for small/dense nodes.
- Capture the changed subtree, not the whole screen.

## Visual checks (each PASS / FAIL with the offending node id)

1. **Alignment**, edges and baselines line up; nothing 1–2px off.
2. **Spacing rhythm**, consistent gaps; padding even on matching sides.
3. **Colour correctness**, fills/text/borders read as the contract tokens
   (cross-check against the consistency result, don't eyeball hex).
4. **Format / structure**, the layout matches the intended pattern (e.g. chip =
   badge + text column + actions; row = consistent stroke + spacing).
5. **Overflow / bounds**, nothing spills past its container; no stray nodes
   far off-canvas (cross-check against `check-bounds.js`).
6. **Icon / text alignment**, icons centered to text, not drifting (watch for
   rescale-anchor drift).
7. **Text truncation**, labels not clipped or overrunning their box.
8. **Equal-height / parity**, sibling cards/controls share height where the
   pattern expects it.

## Cross-checks (structural, not visual)

- **Off-token but looks fine:** trust `check-consistency.js` HIGH/MEDIUM items
  over the eye.
- **Looks off but is correct:** confirm against `summarize-node.js` geometry
  before flagging (e.g. intentional optical offsets).
- **Stray / orphan nodes:** `check-bounds.js` `strayCount > 0` is always a real
  issue even when the screenshot looks clean.

## Loop (slice 3 will automate)

Capture → run checks → if any FAIL, fix → re-capture. Keep going while the fail
count drops; if a pass makes no progress or repeats a fix, stop and surface the
stuck check.
