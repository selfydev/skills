---
name: figma-verify
description: Use when verifying any Figma design change made via the Desktop Bridge / figma-console MCP - vets new nodes for design-system consistency (colours, radii, borders, fonts) against a per-task contract and produces a compact structural snapshot. Read-only first slice; review loop and auto-fix come later.
---

# Figma Verify

A companion layer on top of the existing figma-console MCP + Desktop Bridge. It
does not replace or fork them. It makes the design-consistency rules that are
normally enforced by hand into an automated check.

**Slices 1-3 built and validated live.** Slices 1-2 (consistency + bounds +
screenshot review) are read-only. Slice 3 (`apply-fixes.js`) MUTATES: it applies
a curated list of property edits only, logs before/after, and escalates
structural changes rather than auto-applying them.

## When to use

After creating or modifying nodes in Figma, before declaring the work done.

## Prerequisites

- Figma Desktop open with the target file, Desktop Bridge plugin connected.
- The `figma-console` MCP available (`figma_execute`).

## The routine

1. **Establish the contract.** Start from `references/contract-baseline.md`
   (the auto-derived baseline: palette, radii, border token, font). State only
   the exceptions for this task (e.g. "dark header here", "clone the settings
   toolbar"). Edit the `CONTRACT` block at the top of
   `snippets/check-consistency.js` to match.

2. **Snapshot structure.** Run `snippets/summarize-node.js` via `figma_execute`
   with the target node id substituted for `REPLACE_WITH_NODE_ID`. This returns
   compact JSON (geometry, fills, strokes, radius, text, font, autolayout,
   recursive), the cheap structural truth, no screenshot needed.

3. **Vet consistency.** Run `snippets/check-consistency.js` the same way. It
   walks the node tree and returns `{ violationCount, violations[] }`, each with
   the node id/name, the kind of violation, what was found, and what the contract
   expects.

4. **Report, do not fix (this slice).** Summarise violations grouped by kind.
   For each, give the node, the offending value, and the contract value. Recommend
   the fix; do not apply it yet.

5. **Cross-check against intent.** Compare the snapshot to the task's sourcing
   strategy: were assets instantiated from the library / cloned from the named
   reference, or rebuilt from primitives? Flag rebuilds (violates
   clone-don't-recreate).

## Scope to the work, not the whole screen

Point the node id at the subtree you actually created or edited, NOT a full
screen frame. A whole legacy screen returns mostly noise from untouched chrome
(global nav fonts, legacy greys, instanced-component internals whose ids contain
";"). Verified live: a full Messages screen produced 207 violations, almost all
pre-existing chrome; the handful of real signal was in the new compose-modal
subtree. Scope down first.

## How to run a snippet

The snippets are self-contained. Read the file, substitute the marked
placeholders (node id, and the `CONTRACT` block if overriding), and pass the
whole body to `figma_execute`. Each returns a JSON value. Do not rely on
cross-file imports, every snippet stands alone for the plugin sandbox.

## Honest limits

- Verifies only while the Desktop Bridge is connected.
- Colour matching uses a per-channel tolerance; near-miss tokens may need the
  tolerance tuned in the `CONTRACT` block.
- This slice does not look at pixels. Alignment/spacing/visual-balance checks
  belong to the review-loop slice, not here.

## Slice 2: the review loop

After the structural checks, do the visual review:

1. **Capture** the changed node with `figma_capture_screenshot` (plugin
   `exportAsync`, live state) at scale 1; the plugin caps the longest side at
   1568px. Bump scale only for small/dense nodes.
2. **Run the checklist** in `references/review-checklist.md`, each check is an
   explicit PASS/FAIL with the offending node id, not a vibe.
3. **Cross-check three lenses:** the screenshot (visual), `summarize-node.js` +
   `check-bounds.js` (structural), and `check-consistency.js` (tokens). They
   catch different classes, washed-out colour shows in two, invisible borders
   show structurally first, off-canvas orphans show only in bounds.
4. **Report**, do not fix (this slice). Slice 3 adds the auto-fix loop.

## Slice 3: auto-fix loop (MUTATES)

1. **Build a curated fix list** from the violations, `{nodeId, op, value}` each.
   NEVER a blind sweep: some flagged nodes are intentional (placeholder text is
   legitimately muted; coloured outlines are deliberate). Only list nodes you've
   confirmed are wrong.
2. **Auto-apply property edits only** via `snippets/apply-fixes.js` (colour,
   radius, border, font). It logs before/after; Figma's Cmd+Z reverses them.
3. **Escalate structural changes** (delete / move / reparent). Do NOT auto-apply.
   Record the node's full spec first (for recoverability), confirm it's safe,
   then act only with explicit confirmation.
4. **Re-verify**, re-run the relevant check; confirm the fail count dropped.
   Loop while it keeps dropping; if a pass makes no progress or repeats a fix,
   stop and surface the stuck item (no-progress escape hatch).
5. **Re-capture** to confirm visually.

## Auto-run (optional hook)

You can add a PostToolUse hook in your project (`.claude/settings.json` plus a
small shell script) that fires after figma-console design mutations
(`figma_execute` and the `set_*`/`create_*`/instantiate/clone/move/resize tools)
and injects a reminder to run this skill on the changed node. Every snippet
header carries the `FIGMA_VERIFY_FLOW` sentinel, so the hook can skip
figma-verify's own calls and never loop. When you run the verify snippets, use
the canonical files (which carry the sentinel), not hand-written reads, or the
reminder will fire on your own read.

## Snippets

- `snippets/verify-all.js`, DEFAULT one-shot: consistency + typography + bounds
  in a single call (substitute NODE_ID once).
- `snippets/apply-fixes.js`, apply a curated fix list (property edits, logged).
- `snippets/summarize-node.js`, compact structural snapshot of a node tree.
- `snippets/check-consistency.js`, flag fills/strokes/radii/fonts that violate
  the contract.
- `snippets/check-bounds.js`, flag descendants outside the root's bounds
  (orphans / overflow) that screenshots miss.

## References

- `references/contract-baseline.md`, the canonical token baseline.
- `references/review-checklist.md`, the slice-2 visual review checklist.

## Screens built with figma-render

For any screen or component built with the `figma-render` skill, run its gate (`figma-render gate`) instead of slices 1 and 2 here. It covers auto-layout coverage, stray absolute positioning, sibling overlap, overflow, clipped text, half pixels, default names, unbound values and spec parity, and it knows which raw values the spec chose on purpose. Keep using slice 3 here only for property fixes on files figma-render did not build.
