// check-bounds.js , FIGMA_VERIFY_FLOW (read-only; auto-verify hook ignores this call)
// Flag descendants that fall outside their root node's bounds (orphans / overflow).
// Screenshots miss off-canvas nodes; this catches them structurally.
// Run via figma_execute. Substitute REPLACE_WITH_NODE_ID. Read-only.
//
// figma_execute contract: body must be `return (async () => {...})();`.

return (async () => {
  const NODE_ID = "REPLACE_WITH_NODE_ID";
  const TOLERANCE = 1; // px of slack before a node counts as out of bounds

  const box = (n) => n.absoluteBoundingBox || null;

  const root = await figma.getNodeByIdAsync(NODE_ID);
  if (!root) return { error: `Node not found: ${NODE_ID}` };
  const rb = box(root);
  if (!rb) return { error: `Node has no absoluteBoundingBox: ${NODE_ID}` };

  const outOfBounds = [];
  const t = TOLERANCE;
  const walk = (n) => {
    if (n !== root) {
      const b = box(n);
      if (b) {
        const overLeft = rb.x - b.x;
        const overTop = rb.y - b.y;
        const overRight = b.x + b.width - (rb.x + rb.width);
        const overBottom = b.y + b.height - (rb.y + rb.height);
        const worst = Math.max(overLeft, overTop, overRight, overBottom);
        if (worst > t) {
          outOfBounds.push({
            id: n.id,
            name: n.name,
            type: n.type,
            overflowPx: {
              left: Math.round(Math.max(0, overLeft)),
              top: Math.round(Math.max(0, overTop)),
              right: Math.round(Math.max(0, overRight)),
              bottom: Math.round(Math.max(0, overBottom)),
            },
            // Fully outside (likely a stray/orphan) vs merely clipped.
            fullyOutside:
              b.x >= rb.x + rb.width ||
              b.x + b.width <= rb.x ||
              b.y >= rb.y + rb.height ||
              b.y + b.height <= rb.y,
          });
        }
      }
    }
    if ("children" in n && n.children) n.children.forEach(walk);
  };
  walk(root);

  outOfBounds.sort((a, b) => Number(b.fullyOutside) - Number(a.fullyOutside));
  return {
    nodeId: NODE_ID,
    nodeName: root.name,
    outOfBoundsCount: outOfBounds.length,
    strayCount: outOfBounds.filter((o) => o.fullyOutside).length,
    outOfBounds,
  };
})();
