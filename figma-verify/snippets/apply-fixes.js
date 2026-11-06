// apply-fixes.js , FIGMA_VERIFY_FLOW (verify-loop fix; auto-verify hook ignores this call)
// Apply an EXPLICIT, curated list of fixes. Run via figma_execute. MUTATES.
// Never a blind sweep, each fix names a node and an op. Logs before/after so
// changes are auditable, and Figma's undo (Cmd+Z) reverses them.
//
// SAFETY: this applies deterministic PROPERTY edits only (colour, radius, border,
// font). Structural changes (delete/move/reparent) are NOT auto-applied here , 
// surface those for human confirmation. figma_execute body must be
// `return (async () => {...})();`.
//
// FIXES entry shape:
//   { nodeId, op, value }
//   op = "textColor" | "fill" | "stroke" | "radius"
//   value = "#RRGGBB" for colour ops, number for radius

return (async () => {
  const FIXES = [
    // { nodeId: "<nodeId>", op: "textColor", value: "#4B5563" },
  ];

  const hexToRgb = (hex) => {
    const m = hex.replace("#", "");
    return {
      r: parseInt(m.slice(0, 2), 16) / 255,
      g: parseInt(m.slice(2, 4), 16) / 255,
      b: parseInt(m.slice(4, 6), 16) / 255,
    };
  };
  const toHex = (c) => {
    const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return ("#" + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
  };
  const firstSolidHex = (paints) => {
    if (!Array.isArray(paints)) return null;
    const p = paints.find((x) => x.type === "SOLID");
    return p ? toHex(p.color) : null;
  };

  const results = [];
  for (const fix of FIXES) {
    const n = await figma.getNodeByIdAsync(fix.nodeId);
    if (!n) {
      results.push({ ...fix, ok: false, error: "node not found" });
      continue;
    }
    try {
      let before;
      if (fix.op === "textColor" || fix.op === "fill") {
        before = firstSolidHex(n.fills);
        if (n.type === "TEXT") await figma.loadFontAsync(n.fontName); // guard: font must load before edit
        n.fills = [{ type: "SOLID", color: hexToRgb(fix.value) }];
      } else if (fix.op === "stroke") {
        before = firstSolidHex(n.strokes);
        n.strokes = [{ type: "SOLID", color: hexToRgb(fix.value) }];
      } else if (fix.op === "radius") {
        before = n.cornerRadius;
        n.cornerRadius = fix.value;
      } else {
        results.push({ ...fix, ok: false, error: `unknown op: ${fix.op}` });
        continue;
      }
      results.push({ nodeId: fix.nodeId, name: n.name, op: fix.op, before, after: fix.value, ok: true });
    } catch (e) {
      results.push({ ...fix, ok: false, error: String(e) });
    }
  }
  return { applied: results.filter((r) => r.ok).length, total: FIXES.length, results };
})();
