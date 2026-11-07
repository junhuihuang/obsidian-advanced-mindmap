/**
 * Whole-tree fold levels.
 *
 * markmap only knows per-node folding: a node with `payload.fold` set hides its
 * children. To fold or unfold the *whole* tree one level at a time we keep a
 * notion of the currently visible level (the depth of the shallowest folded
 * parent) and derive the exact set of nodes that have to change.
 *
 * The state we produce is always "every parent at depth >= level is folded and
 * every parent above it is open". That makes each command move the visible
 * level by exactly one and makes toggling between only-the-root and fully
 * expanded trivial.
 */

export interface FoldNode {
  children?: FoldNode[]
  payload?: { fold?: unknown }
}

export type FoldLevelAction = 'foldLevel' | 'unfoldLevel' | 'unfoldAll' | 'toggleAll'

export interface FoldPlan {
  /** Nodes that must become folded to reach the requested level. */
  fold: FoldNode[]
  /** Nodes that must become open to reach the requested level. */
  unfold: FoldNode[]
}

/** Deepest depth of the tree; the root is at depth 0. */
export function treeDepth(root: FoldNode): number {
  let depth = 0
  for (const child of root.children ?? []) depth = Math.max(depth, 1 + treeDepth(child))
  return depth
}

/**
 * Number of visible levels: `0` means only the root is shown, while
 * `treeDepth(root)` means the tree is fully expanded. A node's children stay
 * hidden while any of its ancestors is folded, so the shallowest folded parent
 * decides how much is visible.
 */
export function visibleLevel(root: FoldNode): number {
  const queue: Array<{ node: FoldNode; depth: number }> = [{ node: root, depth: 0 }]
  for (let i = 0; i < queue.length; i++) {
    const { node, depth } = queue[i]
    if (node.children?.length && node.payload?.fold) return depth
    for (const child of node.children ?? []) queue.push({ node: child, depth: depth + 1 })
  }
  return treeDepth(root)
}

/** Level a whole-tree command should end up at, clamped to the tree. */
export function targetLevel(root: FoldNode, action: FoldLevelAction): number {
  const depth = treeDepth(root)
  const level = visibleLevel(root)

  switch (action) {
    case 'foldLevel': return Math.max(0, level - 1)
    case 'unfoldLevel': return Math.min(depth, level + 1)
    case 'unfoldAll': return depth
    case 'toggleAll': return level >= depth ? 0 : depth
  }
}

/** Nodes whose fold flag must change to display exactly `level` levels. */
export function levelPlan(root: FoldNode, level: number): FoldPlan {
  const plan: FoldPlan = { fold: [], unfold: [] }

  const walk = (node: FoldNode, depth: number) => {
    if (node.children?.length) {
      const folded = !!node.payload?.fold
      const shouldFold = depth >= level
      if (shouldFold && !folded) plan.fold.push(node)
      else if (!shouldFold && folded) plan.unfold.push(node)
    }
    for (const child of node.children ?? []) walk(child, depth + 1)
  }

  walk(root, 0)
  return plan
}

/** Convenience: the node changes needed for a whole-tree command. */
export function foldCommandPlan(root: FoldNode, action: FoldLevelAction): FoldPlan {
  return levelPlan(root, targetLevel(root, action))
}

/**
 * The node changes needed to show exactly `level` levels (root included),
 * clamped to the tree. Backs the `z0`…`z9` shortcuts, which jump straight to a
 * depth instead of folding one level at a time.
 */
export function foldToLevelPlan(root: FoldNode, level: number): FoldPlan {
  return levelPlan(root, Math.max(0, Math.min(Math.floor(level), treeDepth(root))))
}

/**
 * Payload mutations for revealing exactly one level of `node`'s subtree: the
 * node itself is unfolded and each of its children is folded, so grandchildren
 * and deeper stay hidden. Used by `l` to walk into a collapsed subtree.
 */
export function revealOneLevel(node: FoldNode): void {
  node.payload = { ...node.payload, fold: 0 }
  for (const child of node.children ?? []) {
    child.payload = { ...child.payload, fold: 1 }
  }
}

/**
 * The node changes that reveal exactly one more level of `node`'s subtree than
 * is currently visible. Unlike `revealOneLevel`, repeated calls keep walking
 * deeper one level at a time, which is what `zo` on a selected node does.
 */
export function revealNextLevelPlan(node: FoldNode): FoldPlan {
  const level = visibleLevel(node)
  if (level >= treeDepth(node)) return { fold: [], unfold: [] }
  return levelPlan(node, level + 1)
}

/**
 * Payload mutations for fully expanding `node`'s subtree: the node and every
 * descendant are unfolded. Used by `zO`.
 */
export function revealAll(node: FoldNode): void {
  node.payload = { ...node.payload, fold: 0 }
  for (const child of node.children ?? []) revealAll(child)
}
