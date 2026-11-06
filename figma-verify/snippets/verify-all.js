// verify-all.js , FIGMA_VERIFY_FLOW (read-only; auto-verify hook ignores this call)
// One-shot verifier: substitute NODE_ID ONCE and get consistency + typography +
// spacing + bounds in a single figma_execute call. Read-only. Returns a combined,
// severity-ranked report. Use this as the default; the single-purpose snippets
// remain for focused runs.
//
// figma_execute contract: body must be `return (async () => {...})();`; guard
// figma.mixed (Symbol) before returning. Scope NODE_ID to the changed subtree.

return (async () => {
  const NODE_ID = "REPLACE_WITH_NODE_ID";

  // --- Contract (override per task; hexes uppercase) ---------------------------
  const CONTRACT = {
    // EXAMPLE values. Replace with your design system's tokens.
    palette: ["#2563EB","#FFFFFF","#111827","#4B5563","#E5E7EB","#F9FAFB",
      "#DC2626","#16A34A","#D97706","#0284C7"],
    allowedBorderColors: ["#E5E7EB", "#2563EB"], // neutral token + intentional coloured outlines
    radii: [0, 4, 8, 9999],                       // r4 controls, r8 cards, 0 top-level, pill
    fontFamily: "Inter",
    fontSizes: [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32], // allowed type scale
    spacingScale: [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32],       // used only if checkSpacing
    tolerance: 4,
  };

  const OPTIONS = {
    skipInstanceInternals: true,
    skipVectorFills: true,
    ignoreHex: [],
    ignoreFonts: [],
    checkTypeScale: true,
    checkSpacing: false, // OFF by default: older files are often not on a strict grid (noisy)
  };
  // -----------------------------------------------------------------------------

  const SEVERITY = {
    "border-not-token": "HIGH", "font-off-contract": "HIGH",
    "radius-off-contract": "MEDIUM", "stroke-off-palette": "MEDIUM",
    "fill-off-palette": "MEDIUM", "font-size-off-scale": "MEDIUM",
    "spacing-off-scale": "LOW", "out-of-bounds": "HIGH", "stray-node": "HIGH",
  };

  const safe = (v) => (v === figma.mixed ? "mixed" : v);
  const toHex = (c) => { const h=(n)=>Math.round(n*255).toString(16).padStart(2,"0"); return ("#"+h(c.r)+h(c.g)+h(c.b)).toUpperCase(); };
  const hexToRgb = (hex) => { const m=hex.replace("#",""); return { r:parseInt(m.slice(0,2),16), g:parseInt(m.slice(2,4),16), b:parseInt(m.slice(4,6),16) }; };
  const near = (hex, list, tol) => { const a=hexToRgb(hex); return list.some((p)=>{ const b=hexToRgb(p); return Math.abs(a.r-b.r)<=tol&&Math.abs(a.g-b.g)<=tol&&Math.abs(a.b-b.b)<=tol; }); };

  const findings = [];
  const add = (n, kind, found, expected) =>
    findings.push({ id:n.id, name:n.name, type:n.type, kind, severity:SEVERITY[kind]||"LOW", found, expected });

  const checkPaints = (n, paints, role) => {
    if (!Array.isArray(paints)) return;
    if (role === "fill" && OPTIONS.skipVectorFills && n.type === "VECTOR") return;
    paints.filter((p)=>p.visible!==false&&p.type==="SOLID").forEach((p)=>{
      const hex = toHex(p.color);
      if (near(hex, OPTIONS.ignoreHex, CONTRACT.tolerance)) return;
      if (!near(hex, CONTRACT.palette, CONTRACT.tolerance)) add(n, `${role}-off-palette`, hex, "contract palette");
      if (role === "stroke" && !near(hex, CONTRACT.allowedBorderColors, CONTRACT.tolerance))
        add(n, "border-not-token", hex, CONTRACT.allowedBorderColors.join(" or "));
    });
  };
  const checkRadius = (n) => {
    const vals = typeof n.cornerRadius === "number" ? [n.cornerRadius]
      : ["topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"].map((k)=>n[k]).filter((v)=>typeof v==="number");
    vals.forEach((v)=>{ if(!CONTRACT.radii.includes(v)) add(n,"radius-off-contract",v,CONTRACT.radii.join("/")); });
  };
  const checkText = (n) => {
    if (n.type !== "TEXT") return;
    if (n.fontName !== figma.mixed) {
      const fam = n.fontName.family;
      if (fam !== CONTRACT.fontFamily && !OPTIONS.ignoreFonts.includes(fam)) add(n, "font-off-contract", fam, CONTRACT.fontFamily);
    }
    if (OPTIONS.checkTypeScale && n.fontSize !== figma.mixed && !CONTRACT.fontSizes.includes(n.fontSize))
      add(n, "font-size-off-scale", n.fontSize, CONTRACT.fontSizes.join("/"));
  };
  const checkSpacing = (n) => {
    if (!OPTIONS.checkSpacing || !n.layoutMode || n.layoutMode === "NONE") return;
    const vals = [["itemSpacing",n.itemSpacing],["paddingTop",n.paddingTop],["paddingRight",n.paddingRight],["paddingBottom",n.paddingBottom],["paddingLeft",n.paddingLeft]];
    vals.forEach(([k,v])=>{ if(typeof v==="number" && !CONTRACT.spacingScale.includes(v)) add(n, "spacing-off-scale", `${k}=${v}`, CONTRACT.spacingScale.join("/")); });
  };

  // bounds
  const box = (n) => n.absoluteBoundingBox || null;
  const root = await figma.getNodeByIdAsync(NODE_ID);
  if (!root) return { error: `Node not found: ${NODE_ID}` };
  const rb = box(root);

  const walk = (n) => {
    if (OPTIONS.skipInstanceInternals && typeof n.id === "string" && n.id.includes(";")) return;
    if ("fills" in n && n.fills !== figma.mixed) checkPaints(n, n.fills, "fill");
    if ("strokes" in n && n.strokes && n.strokes.length) checkPaints(n, n.strokes, "stroke");
    if ("cornerRadius" in n) checkRadius(n);
    checkText(n);
    checkSpacing(n);
    if (rb && n !== root) {
      const b = box(n);
      if (b) {
        const worst = Math.max(rb.x-b.x, rb.y-b.y, b.x+b.width-(rb.x+rb.width), b.y+b.height-(rb.y+rb.height));
        if (worst > 1) {
          const stray = b.x>=rb.x+rb.width || b.x+b.width<=rb.x || b.y>=rb.y+rb.height || b.y+b.height<=rb.y;
          add(n, stray ? "stray-node" : "out-of-bounds", `overflow ${Math.round(worst)}px`, "within parent bounds");
        }
      }
    }
    if ("children" in n && n.children) n.children.forEach(walk);
  };
  walk(root);

  const order = { HIGH:0, MEDIUM:1, LOW:2 };
  findings.sort((a,b)=>order[a.severity]-order[b.severity]);
  const byKind = findings.reduce((a,v)=>{a[v.kind]=(a[v.kind]||0)+1;return a;},{});
  const bySeverity = findings.reduce((a,v)=>{a[v.severity]=(a[v.severity]||0)+1;return a;},{});
  return { nodeId:NODE_ID, nodeName:root.name, findingCount:findings.length, bySeverity, byKind, findings };
})();
