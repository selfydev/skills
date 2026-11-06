// summarize-node.js , FIGMA_VERIFY_FLOW (read-only; auto-verify hook ignores this call)
// Compact structural snapshot of a node tree. Run via figma_execute.
// Substitute REPLACE_WITH_NODE_ID before running. Returns JSON (recursive).
// Self-contained: no imports. The cheap structural truth, no screenshot needed.
//
// figma_execute contract (verified live 2026-06-25):
//   1. The whole body must be `return (async () => { ... })();`, a bare IIFE
//      runs but its value is discarded, surfacing only {success:true}.
//   2. figma.mixed is a Symbol and crashes postMessage ("Cannot unwrap symbol").
//      Pass every possibly-mixed scalar (strokeWeight, fontSize, fontName,
//      cornerRadius) through safe() before returning it.

return (async () => {
  const NODE_ID = "REPLACE_WITH_NODE_ID";
  const MAX_DEPTH = 4;

  const safe = (v) => (v === figma.mixed ? "mixed" : v);
  const toHex = (c) => {
    const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return ("#" + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
  };

  const paintSummary = (paints) => {
    if (!Array.isArray(paints)) return undefined;
    return paints
      .filter((p) => p.visible !== false)
      .map((p) =>
        p.type === "SOLID"
          ? { type: "SOLID", hex: toHex(p.color), opacity: p.opacity ?? 1 }
          : { type: p.type }
      );
  };

  const radiusSummary = (n) => {
    if (typeof n.cornerRadius === "number") return n.cornerRadius;
    const corners = [
      "topLeftRadius",
      "topRightRadius",
      "bottomLeftRadius",
      "bottomRightRadius",
    ]
      .map((k) => n[k])
      .filter((v) => typeof v === "number");
    return corners.length ? corners : undefined;
  };

  const summarize = (n, depth) => {
    const out = {
      id: n.id,
      name: n.name,
      type: n.type,
      x: Math.round(n.x ?? 0),
      y: Math.round(n.y ?? 0),
      w: Math.round(n.width ?? 0),
      h: Math.round(n.height ?? 0),
    };
    if ("fills" in n && n.fills !== figma.mixed) out.fills = paintSummary(n.fills);
    if ("strokes" in n && n.strokes && n.strokes.length) {
      out.strokes = paintSummary(n.strokes);
      out.strokeWeight = safe(n.strokeWeight);
    }
    const r = radiusSummary(n);
    if (r !== undefined) out.radius = r;
    if (n.type === "TEXT") {
      out.characters = n.characters;
      out.fontSize = safe(n.fontSize);
      out.fontName = safe(n.fontName);
    }
    if (n.layoutMode && n.layoutMode !== "NONE") {
      out.autolayout = {
        mode: n.layoutMode,
        itemSpacing: n.itemSpacing,
        padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft],
        primaryAxis: n.primaryAxisAlignItems,
        counterAxis: n.counterAxisAlignItems,
      };
    }
    if (depth < MAX_DEPTH && "children" in n && n.children && n.children.length) {
      out.children = n.children.map((c) => summarize(c, depth + 1));
    }
    return out;
  };

  const node = await figma.getNodeByIdAsync(NODE_ID);
  if (!node) return { error: `Node not found: ${NODE_ID}` };
  return summarize(node, 0);
})();

