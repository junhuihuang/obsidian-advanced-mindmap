import type { IPureNode } from 'markmap-common'

import { SourceNode } from './source-tree'


/**
 * Key used to attach a source path to a markmap node's `payload`.
 *
 * markmap-view replaces every child node with a shallow copy while initializing
 * data (`item.children = item.children.map(child => ({ ...child }))`). The
 * `payload` object itself is copied by reference, so a path stored there
 * survives the copy and can be read back from the DOM (`g.__data__.payload`).
 */
export const SOURCE_PATH_KEY = 'advmmSourcePath'

const COMMENT_RE = /<!--[\s\S]*?-->/g

export function getSourcePath(node: IPureNode): number[] | undefined {
  const path = node.payload?.[SOURCE_PATH_KEY]
  return Array.isArray(path) ? path as number[] : undefined
}

/**
 * Marks a node as render-only, giving it the empty source path exactly like
 * markmap's synthetic root. Such a node can be selected and navigated in the
 * editor but is never mapped onto a line of the document.
 */
export function tagSyntheticRoot(node: IPureNode): IPureNode {
  return { ...node, payload: { ...node.payload, [SOURCE_PATH_KEY]: [] } }
}

/**
 * Walks the transformed markmap tree and tags every node with the path of the
 * source node it was rendered from.
 *
 * The primary mapping uses the `data-lines` attribute that markmap-lib's
 * `sourceLines` plugin attaches to every block: the HTML parser stores the
 * original source line range in `payload.lines`, so the start line can be
 * matched exactly against the source tree. This is immune to markdown
 * formatting differences (entities, emphasis, ordered list prefixes, ...).
 *
 * As a fallback (e.g. hand-built trees without `lines`), nodes are matched by
 * normalized text. A node is only ever tagged when the mapping is confident,
 * so an edit can never be applied to a different-looking line.
 */
export function tagSourcePaths(root: IPureNode, roots: SourceNode[]): void {
  const byLine = new Map<number, number[]>()
  indexByLine(roots, [], byLine)

  let entries: SourceEntry[] | undefined
  let cursor = 0

  const visit = (node: IPureNode) => {
    const line = sourceLine(node)
    const path = line === undefined ? undefined : byLine.get(line)

    // The line plugin covers normal markmap nodes. Avoid normalizing their HTML
    // unless the line mapping is unavailable; this is a hot path on every
    // render and normalization allocates several intermediate strings.
    const content = path ? node.content : normalizeContent(node.content)

    // A prose paragraph between nodes is rendered as an empty container whose
    // `data-lines` starts on the same line as its first child (markmap assigns
    // the paragraph no line of its own). Tagging that container would give it
    // the child's source path: in the DOM the post-order render appends the
    // container after its children, so `byPath` would resolve the path to the
    // invisible container instead of the visible node. Selection, navigation
    // and the inline editor then all target the wrong element.
    const isParagraphContainer = content === '' && node !== root && node.children.length > 0
      && sourceLine(node.children[0]) === line

    // markmap promotes a document's top-level list wrapper (`ul`/`ol`) to the
    // root node, and it fills a textless root with the frontmatter `title:`. That
    // text is a label, not a line of the document, so the wrapper must not take
    // the path of its first item - the visible root and that item would share a
    // path, and selecting the title would highlight the item below it instead.
    const isListWrapperRoot = node === root
      && (node.payload?.tag === 'ul' || node.payload?.tag === 'ol')

    if (!isListWrapperRoot && path && !isParagraphContainer && (content !== '' || node !== root)) {
      node.payload = { ...node.payload, [SOURCE_PATH_KEY]: path }
    }
    else if (!isListWrapperRoot && content !== '') {
      entries ??= flattenSource(roots)
      for (let i = cursor; i < entries.length; i++) {
        if (normalizeText(entries[i].node.text) !== content) continue

        node.payload = { ...node.payload, [SOURCE_PATH_KEY]: entries[i].path }
        cursor = i + 1
        break
      }
    }
    else if (node !== root && path && !isParagraphContainer) {
      node.payload = { ...node.payload, [SOURCE_PATH_KEY]: path }
    }

    node.children.forEach(visit)
  }

  visit(root)

  // The markmap root is a synthetic container when the document has no single
  // top-level node (for example a flat list, or several headings). It has no
  // source line to match, so give it the empty path: navigation uses it to step
  // up from any top-level node (`h`), and folding can target the whole tree.
  if (!getSourcePath(root)) {
    root.payload = { ...root.payload, [SOURCE_PATH_KEY]: [] }
  }
}

/** Start line of a markmap node, taken from the `data-lines` attribute. */
function sourceLine(node: IPureNode): number | undefined {
  const lines = node.payload?.lines
  if (typeof lines !== 'string') return undefined

  const start = Number.parseInt(lines.split(',')[0], 10)
  return Number.isNaN(start) ? undefined : start
}

function indexByLine(nodes: SourceNode[], prefix: number[], byLine: Map<number, number[]>): void {
  for (const [index, node] of nodes.entries()) {
    const path = [...prefix, index]
    byLine.set(node.line, path)
    indexByLine(node.children, path, byLine)
  }
}

interface SourceEntry {
  path: number[]
  node: SourceNode
}

function flattenSource(nodes: SourceNode[], prefix: number[] = []): SourceEntry[] {
  return nodes.flatMap((node, index) => {
    const path = [...prefix, index]
    return [{ path, node }, ...flattenSource(node.children, path)]
  })
}

/** Plain text of a rendered (HTML) markmap node. */
export function normalizeContent(html: string): string {
  return decodeEntities(
    html
      .replace(COMMENT_RE, '')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/^\d+\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain text of a source node's inline markdown. */
export function normalizeText(markdown: string): string {
  return decodeEntities(markdown
    .replace(COMMENT_RE, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/[*_~`]/g, ''))
    .replace(/^\d+\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function fromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}
