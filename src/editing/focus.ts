import type { IPureNode } from 'markmap-common'

import { getSourcePath } from './source-paths'
import { getNodeAtPath, samePath, type SourceNode } from './source-tree'

/**
 * The paths kept prominent in focus mode: the cursor node followed by its
 * direct children (one level down). Children without a source path (for
 * example synthetic wrappers) are skipped, and the result never repeats a path.
 */
export function focusPaths(cursor: number[], node: IPureNode): number[][] {
  const paths = [cursor]
  for (const child of node.children ?? []) {
    const path = getSourcePath(child)
    if (!path || paths.some(existing => samePath(existing, path))) continue
    paths.push(path)
  }
  return paths
}

/**
 * The paths kept prominent by sibling focus: every node in the cursor's
 * sibling group, including the cursor itself. The synthetic root has no
 * siblings, so focusing it keeps only the root prominent.
 */
export function siblingPaths(cursor: number[], roots: SourceNode[]): number[][] {
  if (cursor.length === 0) return [cursor]

  const parentPath = cursor.slice(0, -1)
  try {
    const siblings = parentPath.length === 0
      ? roots
      : getNodeAtPath(roots, parentPath).children
    return siblings.map((_, index) => [...parentPath, index])
  } catch {
    return [cursor]
  }
}
