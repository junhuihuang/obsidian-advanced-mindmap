import { normalizeText } from './source-paths'
import { type SourceNode } from './source-tree'


/** A node that can be searched, with the source path needed to select it. */
export interface SearchableNode {
  path: number[]
  /** Plain text of the node (markdown stripped, whitespace collapsed). */
  text: string
}

/**
 * Flattens a parsed source tree into searchable nodes in document order.
 * Text is normalized so the query matches what the mindmap displays
 * (`**bold**` -> `bold`, `[[Page|Alias]]` -> `Alias`).
 */
export function collectSearchNodes(roots: SourceNode[]): SearchableNode[] {
  const nodes: SearchableNode[] = []

  const walk = (list: SourceNode[], prefix: number[]) => {
    list.forEach((node, index) => {
      const path = [...prefix, index]
      nodes.push({ path, text: normalizeText(node.text) })
      walk(node.children, path)
    })
  }

  walk(roots, [])
  return nodes
}

/** Whether a query is worth running (non-empty after trimming). */
export function isQueryEmpty(query: string): boolean {
  return query.trim().length === 0
}

/**
 * Paths of every node whose text contains `query`, in document order.
 * Matching is case-insensitive; a blank query matches nothing.
 */
export function findMatches(nodes: SearchableNode[], query: string): number[][] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []

  return nodes
    .filter(node => node.text.toLowerCase().includes(needle))
    .map(node => node.path)
}

/**
 * Moves `index` by `delta` within `[0, total)`, wrapping around the ends.
 * Returns 0 when there is nothing to step through.
 */
export function stepIndex(index: number, total: number, delta: number): number {
  if (total <= 0) return 0
  return ((index + delta) % total + total) % total
}
