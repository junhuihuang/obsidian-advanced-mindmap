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
 *
 * A source path is **not** a rendered depth: with plain-text nodes switched off
 * a list item is still `[0, 0, 0]` (heading → paragraph → item) while the canvas
 * draws it one level below the heading. Everything here therefore compares the
 * rendered depth of `ordered`, not `path.length`.
 */
export function findNodeInDirection(
  ordered: number[][],
  current: number[],
  direction: Direction,
): number[] | undefined {
  const index = ordered.findIndex(path => samePath(path, current))
  if (index < 0) return undefined
  const depths = renderedDepths(ordered)

  switch (direction) {
    case 'down':
      return findSameLevel(ordered, depths, index, 1)
    case 'up':
      return findSameLevel(ordered, depths, index, -1)
    case 'left': {
      // The rendered parent, i.e. the closest preceding node one level up. It is
      // not always `path.slice(0, -1)`: a paragraph that is not on the canvas
      // sits between a heading and its list, and the cursor has to skip it.
      for (let i = index - 1; i >= 0; i--) {
        if (depths[i] === depths[index] - 1) return ordered[i]
      }
      return undefined
    }
    case 'right': {
      // In pre-order a node's rendered descendants follow it directly, so the
      // next entry is the first child — unless it is not a descendant, which
      // means this node has no rendered children (or they are all folded away).
      const child = ordered[index + 1]
      return child && isDescendantPath(current, child) ? child : undefined
    }
  }
}

/**
 * Depth of every path in `ordered` **as rendered**: the number of its ancestors
 * that are drawn too. A node whose only parent is a paragraph left out of the
 * canvas is one level shallower than its source path suggests.
 *
 * `ordered` is a pre-order list (source order with the hidden nodes filtered
 * out), so the ancestors of a path are still on the stack when it arrives.
 */
function renderedDepths(ordered: number[][]): number[] {
  const stack: number[][] = []
  return ordered.map(path => {
    while (stack.length > 0 && !isDescendantPath(stack[stack.length - 1], path)) stack.pop()
    stack.push(path)
    return stack.length
  })
}

/** Nearest node of the same rendered level in the given direction. */
function findSameLevel(
  ordered: number[][],
  depths: number[],
  index: number,
  step: 1 | -1,
): number[] | undefined {
  for (let i = index + step; i >= 0 && i < ordered.length; i += step) {
    if (depths[i] === depths[index]) return ordered[i]
  }
  return undefined
}
