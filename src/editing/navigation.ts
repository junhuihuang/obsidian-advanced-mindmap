import type { Direction } from './keymap'
import { samePath } from './source-tree'


/** True when `path` lies strictly inside `ancestor`'s subtree. */
export function isDescendantPath(ancestor: number[], path: number[]): boolean {
  return path.length > ancestor.length && ancestor.every((value, index) => value === path[index])
}

/** A visible node and the screen position of its center. */
export interface NodePosition {
  path: number[]
  x: number
  y: number
}

/**
 * Path of the node whose center is closest to `(x, y)`. Ties keep the node that
 * comes first in `positions` (which is in pre-order), so the result is stable.
 * Returns `undefined` when there are no visible nodes.
 */
export function nearestPath(positions: NodePosition[], x: number, y: number): number[] | undefined {
  let best: NodePosition | undefined
  let bestDistance = Infinity

  for (const position of positions) {
    const dx = position.x - x
    const dy = position.y - y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = position
    }
  }

  return best?.path
}


/**
 * Finds the node to move to.
 *
 * `up`/`down` move between nodes at the same level (siblings first), following
 * the visible pre-order. When there is no further sibling they continue to the
 * nearest node at the same level, so the cursor never gets stuck in the middle
 * of a level. `left` goes to the parent and `right` to the first child.
 *
 * `ordered` is the list of currently rendered node paths in pre-order (folded
 * subtrees are not rendered), so navigation never jumps to a hidden node.
 * Returns `undefined` only at the very top/bottom of a level or the tree.
 */
export function findNodeInDirection(
  ordered: number[][],
  current: number[],
  direction: Direction,
): number[] | undefined {
  const index = ordered.findIndex(path => samePath(path, current))
  if (index < 0) return undefined

  switch (direction) {
    case 'down':
      return findSameLevel(ordered, index, current.length, 1)
    case 'up':
      return findSameLevel(ordered, index, current.length, -1)
    case 'left': {
      if (current.length === 0) return undefined
      const parent = current.slice(0, -1)
      // Step up to the synthetic root (`[]`) only when it is actually rendered.
      return ordered.some(path => samePath(path, parent)) ? parent : undefined
    }
    case 'right': {
      const child = ordered[index + 1]
      if (!child || child.length !== current.length + 1) return undefined

      const isChild = child.slice(0, -1).every((value, i) => value === current[i])
      return isChild ? child : undefined
    }
  }
}

/** Nearest node of the same level in the given direction (skipping deeper ones). */
function findSameLevel(
  ordered: number[][],
  index: number,
  level: number,
  step: 1 | -1,
): number[] | undefined {
  for (let i = index + step; i >= 0 && i < ordered.length; i += step) {
    if (ordered[i].length === level) return ordered[i]
  }
  return undefined
}
