import type { IPureNode } from 'markmap-common'

import { getSourcePath } from 'src/editing/source-paths'
import { flattenPaths, getNodeAtPath, pathKey, type SourceNode } from 'src/editing/source-tree'


/**
 * Headings are drawn at the size and weight of their Markdown level, so a map
 * reads like the preview of the same note. Nothing is added to the node text:
 * list items (markmap keeps their `1. ` prefix) and prose stay body text, and
 * the heading level is what sets the nodes apart.
 *
 * The level travels in the node payload, then in a DOM attribute `styles.css`
 * hangs its six rules on. It cannot be a class: markmap rewrites the `class`
 * attribute of every node on each render.
 */

/** Payload key holding the heading level (1-6) of a rendered node. */
const LEVEL_KEY = 'advmmHeadingLevel'

/** DOM attribute holding the same level; the sizes live in `styles.css`. */
export const HEADING_LEVEL_ATTR = 'data-advmm-h'

interface LevelData {
  payload?: Record<string, unknown>
}

/**
 * Tags every rendered heading with the level of the source line it came from.
 *
 * Runs on the transformed tree, so it must come after `tagSourcePaths` (for the
 * paths). Textless containers (`ul`/`ol` wrappers, the empty paragraph
 * container) are skipped: styling an invisible box only moves the layout.
 */
export function tagHeadingLevels(root: IPureNode, sourceRoots: SourceNode[]): void {
  const rendered = new Map<string, IPureNode>()
  const visit = (node: IPureNode) => {
    const path = getSourcePath(node)
    if (path) rendered.set(pathKey(path), node)
    for (const child of node.children) visit(child)
  }
  visit(root)

  for (const path of flattenPaths(sourceRoots)) {
    const node = rendered.get(pathKey(path))
    if (!node || node.content === '') continue
    const source = getNodeAtPath(sourceRoots, path)
    if (source.kind === 'heading') node.payload = { ...node.payload, [LEVEL_KEY]: source.level }
  }
}

/**
 * Writes the attribute the CSS reads, for every rendered node.
 *
 * Called again on each render: new nodes have no attribute yet, and markmap's
 * own class rewrite is what the attribute avoids depending on.
 */
export function applyHeadingLevels(groups: Iterable<SVGGElement>): void {
  for (const group of groups) {
    const level = (group as unknown as { __data__?: LevelData }).__data__?.payload?.[LEVEL_KEY]
    const wanted = typeof level === 'number' && level >= 1 && level <= 6 ? String(level) : null
    if (group.getAttribute(HEADING_LEVEL_ATTR) === wanted) continue
    if (wanted === null) group.removeAttribute(HEADING_LEVEL_ATTR)
    else group.setAttribute(HEADING_LEVEL_ATTR, wanted)
  }
}
