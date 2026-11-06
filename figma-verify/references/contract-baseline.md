# Contract baseline

The starting point for a task contract. State only the exceptions per task;
everything else inherits from here.

**The values below are examples.** Replace them with your design system's
tokens, and keep the `CONTRACT` blocks in `snippets/check-consistency.js` and
`snippets/verify-all.js` in sync with this file.

## Palette (allowed fills/strokes)

| Token | Hex | Role |
|-------|-----|------|
| Primary | `#2563EB` | Selected / active / accent |
| White | `#FFFFFF` | Surface, selected-container fill |
| Ink | `#111827` | Headings, structural chrome |
| Body ink | `#4B5563` | Secondary text |
| Border | `#E5E7EB` | The single neutral border token |
| Light surface | `#F9FAFB` | Page background |

If your chrome colour varies by surface, sample the live node, do not pick from
memory.

## Radii

- `4`: controls (inputs, buttons, checkboxes).
- `8`: cards / containers.
- `0`: top-level containers (no radius, no stroke).
- Pill / fully rounded where intended.

Borders: one neutral token `#E5E7EB`. Coloured control outlines (e.g. a primary
`#2563EB` outlined button) are an intentional exception and are allowed.

## Type

- Family: **Inter** (all weights). Some weights load via `loadFontAsync` even
  when font enumeration omits them.
- Size scale (allowed): `10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32`.
  Sizes off this list are flagged `font-size-off-scale` (MEDIUM).

## Spacing

- Auto-layout `itemSpacing` / padding scale: `0, 2, 4, 6, 8, 10, 12, 16, 20, 24,
  32`. The spacing check is **opt-in** (`OPTIONS.checkSpacing = true`) because
  older files are often not on a strict grid. Turn it on once a spacing scale is
  agreed.

## Validation-state colours (when applicable)

Tailwind 600 mid-tones: Error `#DC2626`, Success `#16A34A`, Warning `#D97706`,
Info `#0284C7`.

## Sourcing strategy (state per task)

One of:
- **Library**: instantiate from the component library.
- **Clone**: clone from a named page / node (give the id).
- **Reuse**: reuse an existing screen family (name it).

Default: clone, don't recreate. Never rebuild an existing component from
primitives.

## Reference set (state per task)

Which existing screens this must stay consistent with, so exact values are
sampled from live nodes rather than approximated.
