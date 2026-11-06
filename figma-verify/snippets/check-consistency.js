// check-consistency.js , FIGMA_VERIFY_FLOW (read-only; auto-verify hook ignores this call)
// Flag fills/strokes/radii/fonts that violate the contract. Run via figma_execute.
// Substitute REPLACE_WITH_NODE_ID and override the CONTRACT / OPTIONS per task.
// Self-contained: no imports. Read-only, reports, never mutates.
//
// figma_execute contract: the body must be `return (async () => {...})();` , 
// a bare IIFE runs but its value is discarded (verified live 2026-06-25).
//
// SCOPE THIS TO THE CHANGED SUBTREE, NOT A WHOLE SCREEN FRAME.
// Running on a full legacy screen returns mostly noise from untouched chrome.
// Point NODE_ID at the node you created/edited. OPTIONS below suppress the
// known noise classes (instance internals, decorative icon vectors, an explicit
// legacy ignore-list) so real signal floats up. Results are severity-ranked.

return (async () => {
  const NODE_ID = "REPLACE_WITH_NODE_ID";

  // --- Contract (override per task; hexes uppercase) ---------------------------
  const CONTRACT = {
    // EXAMPLE values. Replace with your design system's tokens.
    palette: [
      "#2563EB", // primary / accent
      "#FFFFFF", // surface
      "#111827", // ink (headings, chrome)
      "#4B5563", // body ink
      "#E5E7EB", // single neutral border token
      "#F9FAFB", // light surface
    ],
    borderToken: "#E5E7EB",
    // Neutral container borders must be the token. Coloured control outlines
    // (e.g. a primary outlined button) are intentional, so allow them too.
    allowedBorderColors: ["#E5E7EB", "#2563EB"],
    radii: [0, 4, 8, 9999], // r4 controls, r8 cards, 0 top-level, 9999 pill
    fontFamily: "Inter",
    tolerance: 4, // per-channel 0-255 distance allowed when matching palette
  };

  // --- Options (noise control) -------------------------------------------------
  const OPTIONS = {
    skipInstanceInternals: true, // ids containing ";", you don't own these
    skipVectorFills: true, // VECTOR fills are usually icon paint, not DS colour
    ignoreHex: [], // explicit legacy hexes to treat as out of scope
    ignoreFonts: [], // e.g. ["Source Sans Pro"] for known-legacy chrome
  };
  // -----------------------------------------------------------------------------

  const SEVERITY = {
    "border-not-token": "HIGH",
    "font-off-contract": "HIGH",
    "radius-off-contract": "MEDIUM",
    "stroke-off-palette": "MEDIUM",
    "fill-off-palette": "MEDIUM",
  };

  const toHex = (c) => {
    const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return ("#" + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
  };
  const hexToRgb = (hex) => {
    const m = hex.replace("#", "");
    return {
      r: parseInt(m.slice(0, 2), 16),
      g: parseInt(m.slice(2, 4), 16),
      b: parseInt(m.slice(4, 6), 16),
    };
  };
  const near = (hex, list, tol) => {
    const a = hexToRgb(hex);
    return list.some((p) => {
      const b = hexToRgb(p);
      return (
        Math.abs(a.r - b.r) <= tol &&
        Math.abs(a.g - b.g) <= tol &&
        Math.abs(a.b - b.b) <= tol
      );
    });
  };

  const isIgnoredHex = (hex) => near(hex, OPTIONS.ignoreHex, CONTRACT.tolerance);

  const violations = [];
  const add = (n, kind, found, expected) =>
    violations.push({
      id: n.id,
      name: n.name,
      type: n.type,
      kind,
      severity: SEVERITY[kind] || "LOW",
      found,
      expected,
    });

  const checkPaints = (n, paints, role) => {
    if (!Array.isArray(paints)) return;
    if (role === "fill" && OPTIONS.skipVectorFills && n.type === "VECTOR") return;
    paints
      .filter((p) => p.visible !== false && p.type === "SOLID")
      .forEach((p) => {
        const hex = toHex(p.color);
        if (isIgnoredHex(hex)) return;
        if (!near(hex, CONTRACT.palette, CONTRACT.tolerance)) {
          add(n, `${role}-off-palette`, hex, "contract palette");
        }
        if (role === "stroke" && !near(hex, CONTRACT.allowedBorderColors, CONTRACT.tolerance)) {
          add(n, "border-not-token", hex, CONTRACT.allowedBorderColors.join(" or "));
        }
      });
  };

  const checkRadius = (n) => {
    const vals =
      typeof n.cornerRadius === "number"
        ? [n.cornerRadius]
        : [
            "topLeftRadius",
            "topRightRadius",
            "bottomLeftRadius",
            "bottomRightRadius",
          ]
            .map((k) => n[k])
            .filter((v) => typeof v === "number");
    vals.forEach((v) => {
      if (!CONTRACT.radii.includes(v)) {
        add(n, "radius-off-contract", v, CONTRACT.radii.join("/"));
      }
    });
  };

  const checkFont = (n) => {
    if (n.type === "TEXT" && n.fontName !== figma.mixed) {
      const fam = n.fontName.family;
      if (fam !== CONTRACT.fontFamily && !OPTIONS.ignoreFonts.includes(fam)) {
        add(n, "font-off-contract", fam, CONTRACT.fontFamily);
      }
    }
  };

  const walk = (n) => {
    if (OPTIONS.skipInstanceInternals && typeof n.id === "string" && n.id.includes(";")) {
      return; // inside an instance, out of scope
    }
    if ("fills" in n && n.fills !== figma.mixed) checkPaints(n, n.fills, "fill");
    if ("strokes" in n && n.strokes && n.strokes.length) checkPaints(n, n.strokes, "stroke");
    if ("cornerRadius" in n) checkRadius(n);
    checkFont(n);
    if ("children" in n && n.children) n.children.forEach(walk);
  };

  const node = await figma.getNodeByIdAsync(NODE_ID);
  if (!node) return { error: `Node not found: ${NODE_ID}` };
  walk(node);

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  violations.sort((a, b) => order[a.severity] - order[b.severity]);

  const byKind = violations.reduce((acc, v) => {
    acc[v.kind] = (acc[v.kind] || 0) + 1;
    return acc;
  }, {});
  const bySeverity = violations.reduce((acc, v) => {
    acc[v.severity] = (acc[v.severity] || 0) + 1;
    return acc;
  }, {});

  return {
    nodeId: NODE_ID,
    nodeName: node.name,
    violationCount: violations.length,
    bySeverity,
    byKind,
    violations,
  };
})();
