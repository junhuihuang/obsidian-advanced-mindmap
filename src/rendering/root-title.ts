import type { IPureNode } from 'markmap-common'

import { getSourcePath, tagSyntheticRoot } from 'src/editing/source-paths'

/**
 * Whether the note's name has to be wrapped *above* the document's root node.
 *
 * False for the cases where the title is already there or needs no level:
 *
 * - A document with a single `# H1` renders that heading *as* the root, so the
 *   note already names itself; wrapping the file name above it drew the title
 *   twice.
 * - A root whose content came from the frontmatter `title:` is render-only (it
 *   has no line of the document), and its text already is the note's title.
 * - A textless root (prose only, a flat list, several headings) can be named in
 *   place, without adding a level.
 *
 * Only a root that is a real node of the document and not its `H1` — a lone
 * list item, a document starting at `## H2` — gets a wrapper. Used by the caller
 * to decide whether `initialExpandLevel` has to shift by one.
 */
export function titleWrapsRoot(root: IPureNode): boolean {
  if (root.content === '') return false
  // No document lines = markmap's synthetic container (named from frontmatter).
  if (getSourcePath(root)?.length === 0) return false
  return !isTopLevelHeading(root)
}

/**
 * Puts the note's name above the markdown's own root node.
 *
 * Depending on the document, the title is either wrapped in a new root node,
 * written into a textless synthetic root, or not added at all (`titleWrapsRoot`
 * describes which).
 *
 * The wrapper is render-only: it takes the empty source path (the same one
 * markmap's synthetic root uses), so the editor can select and navigate it but
 * never writes it back to the note. The note is therefore never modified just to
 * show its title, the title never repeats a heading the note already has when
 * there is no wrapper to add, and the root stays the same node no matter how
 * many top-level nodes the document has.
 */
export function addTitleToRootNode(root: IPureNode, title: string): IPureNode {
  if (!titleWrapsRoot(root)) {
    // Either a textless root, which the title can name in place, or a root that
    // must keep the text it has (the document's own `H1` / frontmatter title).
    if (root.content === '') root.content = title
    return root
  }

  return tagSyntheticRoot({ content: title, children: [root] })
}

/**
 * True when the root node is the document's own `# H1`.
 *
 * markmap keeps the HTML tag a node was rendered from in `payload.tag`, so a
 * root tagged `h1` came from a heading of the note — not from a container that
 * needs naming. `getSourcePath` is already checked by the caller: a heading has
 * a line of the document.
 */
function isTopLevelHeading(root: IPureNode): boolean {
  return root.payload?.tag === 'h1'
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
