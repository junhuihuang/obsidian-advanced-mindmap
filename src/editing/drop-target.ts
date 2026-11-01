/** Where a dragged node lands relative to another node. */
export type DropPosition = 'child' | 'before' | 'after'

export interface DropTarget {
  position: DropPosition
  /** The node to drop onto (`child`) or next to (`before` / `after`). */
  path: number[]
}

/** The viewport box of one rendered node. */
export interface DropBox {
  path: number[]
  left: number
  right: number
  top: number
  bottom: number
}

/** Fraction of a node's height at the top/bottom that means "insert next to it". */
const EDGE = 0.3
/** Horizontal reach, in pixels, when the pointer is between two siblings. */
const HORIZONTAL_REACH = 40

function isPathPrefix(prefix: number[], path: number[]): boolean {
  return prefix.length <= path.length && prefix.every((value, index) => value === path[index])
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function boxContains(box: DropBox, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

function boxArea(box: DropBox): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
}

/**
 * Decides where a node dragged to `(x, y)` should land.
 *
 * - Over a node: its top/bottom `EDGE` thirds insert next to it (`before` /
 *   `after`); the middle third makes it a child.
 * - Over empty space (the gap between two siblings): the nearest horizontally
 *   reachable node becomes the anchor, and the pointer's side of its vertical
 *   centre decides `before` or `after`.
 *
 * `hoveredPath` is the node the browser reports under the pointer
 * (`elementFromPoint`); when the caller knows it, it wins over the box test,
 * which keeps the child-drop behaviour in environments without real layout
 * (jsdom). Nodes inside the dragged subtree are never returned as targets.
 */
export function resolveDropTarget(
  x: number,
  y: number,
  boxes: DropBox[],
  draggedPath: number[],
  hoveredPath: number[] | null = null,
): DropTarget | null {
  const valid = boxes.filter(box => !isPathPrefix(draggedPath, box.path))
  // Ancestors are valid targets only when the user explicitly hovers over
  // them; in the gap-finding logic they are skipped, otherwise a drop
  // between the parent and its next sibling would land "after parent"
  // (which keeps the node inside the parent) instead of "before sibling".
  const nonAncestors = valid.filter(box => !isPathPrefix(box.path, draggedPath))

  const edgeOf = (box: DropBox): DropTarget => {
    const height = box.bottom - box.top
    if (height > 0) {
      const rel = (y - box.top) / height
      if (rel < EDGE) return { position: 'before', path: box.path }
      if (rel > 1 - EDGE) return { position: 'after', path: box.path }
    }
    return { position: 'child', path: box.path }
  }

  if (hoveredPath && hoveredPath.length > 0) {
    // Hovering the dragged node itself or one of its descendants is never a
    // valid drop: the node would have to move into (or next to) itself.
    if (isPathPrefix(draggedPath, hoveredPath)) return null
    const hovered = valid.find(box => samePath(box.path, hoveredPath))
    if (hovered) return edgeOf(hovered)
  }

  const containing = valid.filter(box => boxContains(box, x, y))
  containing.sort((a, b) => boxArea(a) - boxArea(b))
  const hovered = containing[0]
  if (hovered) {
    // Over an ancestor: only accept the part the user explicitly hovers on.
    return edgeOf(hovered)
  }

  let nearest: DropBox | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const box of nonAncestors) {
    const reach = (box.right - box.left) / 2 + HORIZONTAL_REACH
    if (x < box.left - reach || x > box.right + reach) continue
    const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = box
    }
  }
  if (!nearest) return null

  const midpoint = (nearest.top + nearest.bottom) / 2
  return { position: y < midpoint ? 'before' : 'after', path: nearest.path }
}
