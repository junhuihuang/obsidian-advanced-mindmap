import type { IPureNode } from 'markmap-common'

import { tagSyntheticRoot } from 'src/editing/source-paths'

/**
 * Puts the note's name above the markdown's own root node.
 *
 * A document without a single top-level node (prose only, a flat list, several
 * headings) renders as a synthetic root that carries no text, so the title can
 * simply be written into it. A document that has one — `# My note`, or a lone
 * list item — renders that node *as* the root, so the title is wrapped around it
 * in a new root node instead.
 *
 * The wrapper is render-only: it takes the empty source path (the same one
 * markmap's synthetic root uses), so the editor can select and navigate it but
 * never writes it back to the note. The note is therefore never modified just to
 * show its title, the title never repeats a heading the note already has when
 * there is no wrapper to add, and the root stays the same node no matter how
 * many top-level nodes the document has.
 */
export function addTitleToRootNode(root: IPureNode, title: string): IPureNode {
  if (root.content === '') {
    // The root has no text of its own, so the title can name it in place.
    root.content = title
    return root
  }

  return tagSyntheticRoot({ content: title, children: [root] })
}

/**
 * `initialExpandLevel` for a tree wrapped by `addTitleToRootNode`.
 *
 * markmap counts the root itself as the first level, so the wrapper would steal
 * one level from the document: `Expand level: 2` would show only the title.
 * Shifting the setting keeps the document as expanded as it was asked to be.
 */
export function expandLevelWithTitle(level: number | undefined): number | undefined {
  if (typeof level !== 'number' || level < 0) return level
  return level + 1
}
