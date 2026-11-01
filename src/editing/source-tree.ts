/**
 * A source-level view of a markdown document used for bidirectional editing.
 *
 * markmap's own transform (`markmap-lib`) is one-way: it turns markdown into a
 * tree of `IPureNode`s whose `content` is already rendered HTML and whose
 * heading/list structure is mostly lost. That makes it impossible to write
 * edits back losslessly.
 *
 * This module keeps a parallel tree that preserves the original markdown
 * syntax (heading level, list marker, indentation, checkbox, inline text and
 * the exact source line). Edits are applied line-by-line so that everything we
 * do not understand (frontmatter, paragraphs, code blocks, ...) is preserved
 * untouched.
 */

export type NodeKind = 'heading' | 'list' | 'code' | 'table' | 'paragraph'

export interface SourceNode {
  kind: NodeKind
  /** Heading level 1-6, or 0 for list items and blocks. */
  level: number
  /** Leading indentation in spaces (0 for headings). */
  indent: number
  /** `#`..`######` for headings, or `-`, `*`, `+`, `1.` for lists. */
  marker: string
  /** `' '` for unchecked, `'x'` for checked, `null` when not a task item. */
  checkbox: ' ' | 'x' | null
  /** Inline markdown text (may contain html comments / wikilinks). */
  text: string
  /** Raw leading whitespace of the node's line (preserves tabs vs spaces). */
  indentText: string
  /**
   * Raw source lines of an opaque block (`code`/`table`). These are kept
   * verbatim so code and table content is never re-serialized.
   */
  raw?: string[]
  /** 0-based line index of this node's own line. */
  line: number
  /** 0-based line index of the last line of this node's subtree. */
  endLine: number
  children: SourceNode[]
}

export type EditOperation =
  | { type: 'setText', path: number[], text: string }
  /**
   * Adds a child. `path` may be the synthetic root's empty path, which appends a
   * new top-level node (see `rootChildTarget`).
   */
  | { type: 'addChild', path: number[], text: string }
  | { type: 'addSibling', path: number[], text: string }
  | { type: 'remove', path: number[] }

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const LIST_RE = /^([ \t]*)([-*+]|\d+\.)\s+(.*)$/
const TASK_RE = /^\[([ xX])\]\s+(.*)$/
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/
const TABLE_ROW_RE = /^[ \t]*\|/
const TABLE_DELIMITER_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const THEMATIC_BREAK_RE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

function isBlock(node: SourceNode): boolean {
  return node.kind === 'code' || node.kind === 'table'
}

/**
 * Parses an opaque block (fenced code or table) starting at `index`.
 *
 * markmap renders these as single nodes, so the source tree must model them
 * too; otherwise they exist in the mindmap but have no source path (and can
 * neither be selected nor edited).
 */
function parseBlock(lines: string[], index: number): { node: SourceNode, next: number } | null {
  const line = lines[index]

  const fence = line.match(FENCE_RE)
  if (fence) {
    const indentText = fence[1]
    const marker = fence[2]
    let end = index + 1
    while (end < lines.length && !lines[end].trimStart().startsWith(marker)) end++
    const endLine = Math.min(end, lines.length - 1)
    const raw = lines.slice(index, endLine + 1)

    return {
      node: makeBlock('code', lines, index, endLine, indentText, marker),
      next: endLine + 1,
    }
  }

  if (TABLE_ROW_RE.test(line) && TABLE_DELIMITER_RE.test(lines[index + 1] ?? '')) {
    let end = index + 1
    while (end + 1 < lines.length && TABLE_ROW_RE.test(lines[end + 1])) end++

    return {
      node: makeBlock('table', lines, index, end, line.match(/^[ \t]*/)![0], '|'),
      next: end + 1,
    }
  }

  return null
}

function makeBlock(kind: 'code' | 'table', lines: string[], line: number, endLine: number, indentText: string, marker: string): SourceNode {
  const raw = lines.slice(line, endLine + 1)
  const body = kind === 'code' ? raw.slice(1, hasClosingFence(raw, marker) ? -1 : undefined) : raw
  return {
    kind,
    level: 0,
    indent: indentText.replace(/\t/g, '    ').length,
    indentText,
    marker,
    checkbox: null,
    text: (kind === 'code' ? stripIndent(body, indentText) : body).join('\n'),
    raw,
    line,
    endLine,
    children: [],
  }
}

/** Removes the block's own indentation from the body lines. */
function stripIndent(body: string[], indentText: string): string[] {
  if (!indentText) return body
  return body.map(line => line.startsWith(indentText) ? line.slice(indentText.length) : line)
}

/** True when the last raw line closes the fence opened by `marker`. */
function hasClosingFence(raw: string[], marker: string): boolean {
  return raw.length > 1 && raw[raw.length - 1].trimStart().startsWith(marker)
}

function isOrdered(marker: string): boolean {
  return marker.endsWith('.')
}

function parseLine(line: string, index: number): SourceNode | null {
  const heading = line.match(HEADING_RE)
  if (heading) {
    return {
      kind: 'heading',
      level: heading[1].length,
      indent: 0,
      indentText: '',
      marker: heading[1],
      checkbox: null,
      text: heading[2].trim(),
      line: index,
      endLine: index,
      children: [],
    }
  }

  const list = line.match(LIST_RE)
  if (!list) return null

  let text = list[3]
  let checkbox: SourceNode['checkbox'] = null
  const task = text.match(TASK_RE)
  if (task) {
    checkbox = task[1].toLowerCase() === 'x' ? 'x' : ' '
    text = task[2]
  }

  const indentText = list[1]
  return {
    kind: 'list',
    level: 0,
    indent: indentText.replace(/\t/g, '    ').length,
    indentText,
    marker: list[2],
    checkbox,
    text: text.trim(),
    line: index,
    endLine: index,
    children: [],
  }
}

/**
 * Parses a prose paragraph as a mindmap node.
 *
 * Every paragraph is a node, including plain prose that is not followed by a
 * list or other renderable block. `markmap-lib` drops such paragraphs, so the
 * renderer adds them back afterwards (see `insertProseNodes`). The paragraph
 * owns any renderable block directly below it, which lets a prose sentence
 * introduce a list in the mindmap.
 */
function parseParagraph(lines: string[], index: number, stack: SourceNode[]): SourceNode | null {
  const line = lines[index]
  if (!line.trim()) return null
  if (parseBlock(lines, index) || parseLine(line, index)) return null
  if (/^[ \t]*>/.test(line)) return null
  if (THEMATIC_BREAK_RE.test(line)) return null

  const indentText = line.match(/^[ \t]*/)![0]
  const indent = indentLength(indentText)
  // Four spaces would be an indented code block; deeper lines belong to the
  // content of an enclosing list item rather than to a new top-level paragraph.
  if (indent > 3) return null
  if (stack.some(node => node.kind === 'list' && node.indent < indent)) return null

  // A non-blank line directly after a list item is a lazy continuation of that
  // item, not a new paragraph (CommonMark keeps it inside the item).
  const top = stack[stack.length - 1]
  if (top?.kind === 'list' && index > 0 && lines[index - 1].trim() !== '') return null

  let end = index + 1
  while (end < lines.length) {
    const next = lines[end]
    if (!next.trim()) break
    if (parseBlock(lines, end) || parseLine(next, end)) break
    if (THEMATIC_BREAK_RE.test(next)) break
    end++
  }

  const raw = lines.slice(index, end)
  const text = raw
    .map(rawLine => rawLine.startsWith(indentText) ? rawLine.slice(indentText.length) : rawLine)
    .join('\n')
    .trimEnd()

  return {
    kind: 'paragraph',
    level: 0,
    indent,
    indentText,
    marker: '',
    checkbox: null,
    text,
    raw,
    line: index,
    endLine: end - 1,
    children: [],
  }
}

/**
 * Finds the parent of `node` given the current path `stack`, following the
 * same rules markmap uses when it builds its tree: headings nest by level,
 * list items nest by indentation and lists attach to the closest heading.
 */
function findParent(stack: SourceNode[], node: SourceNode): SourceNode | null {
  while (stack.length) {
    const top = stack[stack.length - 1]

    if (node.kind === 'heading') {
      if (top.kind !== 'heading' || top.level >= node.level) {
        stack.pop()
        continue
      }
      break
    }

    // Lists/blocks immediately after prose belong to that prose node.
    if (top.kind === 'paragraph') break

    if (top.kind !== 'heading' && top.indent >= node.indent) {
      stack.pop()
      continue
    }
    break
  }

  return stack[stack.length - 1] ?? null
}

function computeEndLines(nodes: SourceNode[]): void {
  for (const node of nodes) {
    computeEndLines(node.children)
    for (const child of node.children) {
      if (child.endLine > node.endLine) node.endLine = child.endLine
    }
  }
}

export function parseSource(markdown: string): SourceNode[] {
  return parseSourceLines(markdown.split('\n'))
}

/**
 * Parses the lines of a document. Callers that already split the markdown (or
 * that hold the lines of an edit in progress) use this to avoid splitting the
 * whole document a second time: a scan over every line is the expensive part of
 * an edit, so it is done once.
 */
export function parseSourceLines(lines: string[]): SourceNode[] {
  const roots: SourceNode[] = []
  const stack: SourceNode[] = []

  for (let i = skipFrontmatter(lines); i < lines.length; i++) {
    const paragraph = parseParagraph(lines, i, stack)
    if (paragraph) {
      // A new paragraph starts a new block: drop the previous list/paragraph
      // (and any block nested in them) and attach below the current heading.
      while (stack.length && stack[stack.length - 1].kind !== 'heading') stack.pop()
      const parent = stack[stack.length - 1] ?? null
      if (parent) parent.children.push(paragraph)
      else roots.push(paragraph)
      stack.push(paragraph)
      i = paragraph.endLine
      continue
    }

    const block = parseBlock(lines, i)
    const node = block?.node ?? parseLine(lines[i], i)
    if (block) i = block.next - 1
    if (!node) continue

    const parent = findParent(stack, node)
    if (parent) parent.children.push(node)
    else roots.push(node)

    stack.push(node)
  }

  computeEndLines(roots)
  return roots
}

/**
 * Returns the index of the first line after a leading YAML frontmatter block.
 * Frontmatter is skipped so that list-like values (`  - foo`) are not mistaken
 * for mindmap nodes.
 */
function skipFrontmatter(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '---' || trimmed === '...') return i + 1
  }

  return lines.length
}

export function getNodeAtPath(nodes: SourceNode[], path: number[]): SourceNode {
  if (path.length === 0) throw new Error('Empty node path')

  let siblings = nodes
  let node: SourceNode | undefined

  for (const index of path) {
    node = siblings[index]
    if (!node) throw new Error(`No node at path [${path.join(', ')}]`)
    siblings = node.children
  }

  return node!
}

type NodeLine = Pick<SourceNode, 'kind' | 'level' | 'marker' | 'indentText' | 'checkbox' | 'text' | 'raw'>

function formatLine(node: NodeLine): string {
  if (node.kind === 'heading')
    return `${'#'.repeat(node.level)} ${node.text}`

  // Opaque blocks and paragraphs keep their original source lines; `applyEdit`
  // rebuilds them as a whole rather than through a single formatted line.
  if (node.kind === 'code' || node.kind === 'table' || node.kind === 'paragraph')
    return node.raw?.[0] ?? node.text

  const checkbox = node.checkbox ? `[${node.checkbox}] ` : ''
  return `${node.indentText}${node.marker} ${checkbox}${node.text}`
}

/** Source lines for a new paragraph body, keeping the original indentation. */
function formatParagraph(node: SourceNode, text: string): string[] {
  return text.split('\n').map(line => line ? node.indentText + line : line)
}

export function serializeSource(nodes: SourceNode[]): string {
  const lines: string[] = []
  const walk = (list: SourceNode[]) => {
    for (const node of list) {
      if (isBlock(node) || node.kind === 'paragraph') lines.push(...(node.raw ?? [node.text]))
      else lines.push(formatLine(node))
      walk(node.children)
    }
  }
  walk(nodes)
  return lines.join('\n')
}

/**
 * Rebuilds an opaque block from new content. A code block keeps its opening
 * fence (including the info string) and indentation; the body is replaced
 * verbatim. A table is replaced with the raw rows.
 */
function formatBlock(node: SourceNode, text: string): string[] {
  const raw = node.raw ?? []
  if (node.kind === 'table') return text.split('\n')

  const open = raw[0] ?? `${node.indentText}\`\`\``
  const body = text.split('\n').map(line => line ? node.indentText + line : line)
  if (hasClosingFence(raw, node.marker)) return [open, ...body, raw[raw.length - 1]]
  return [open, ...body]
}

type NewNode = NodeLine

/** True when any node in the tree uses tab indentation. */
function usesTabs(nodes: SourceNode[]): boolean {
  return nodes.some(node => node.indentText.includes('\t') || usesTabs(node.children))
}

/**
 * Indentation for a child of `parent`.
 *
 * Markdown-it nests a sub-list only when it is indented to at least the
 * parent's content column, which is `marker.length + 1` (3 for `1. `, 2 for
 * `- `, 4 for `10. `). Using a fixed 2-space indent made ordered-list children
 * render as siblings instead of children.
 */
function childIndentText(parent: SourceNode, tabs: boolean): string {
  if (parent.kind === 'heading') return ''
  // A paragraph's list sits at the paragraph's own indentation.
  if (parent.kind === 'paragraph') return parent.children[0]?.indentText ?? parent.indentText
  // A block cannot really own a list in markdown, but nesting it one level in
  // the source tree keeps the new node addressable. Two spaces so a following
  // list is not mistaken for an indented code block.
  if (isBlock(parent)) return tabs ? `${parent.indentText}\t` : ' '.repeat(parent.indent + 2)

  // Match the indentation of the existing children so new nodes look native.
  const existing = parent.children[0]
  if (existing) return existing.indentText

  if (tabs) return `${parent.indentText}\t`

  return ' '.repeat(parent.indent + parent.marker.length + 1)
}

function makeChild(parent: SourceNode, text: string, tabs: boolean): NewNode {
  if (parent.kind === 'heading') {
    if (parent.level < 6) {
      const level = parent.level + 1
      return { kind: 'heading', level, marker: '#'.repeat(level), indentText: '', checkbox: null, text }
    }
    return { kind: 'list', level: 0, marker: '-', indentText: '', checkbox: null, text }
  }

  const firstChild = parent.kind === 'paragraph' ? parent.children[0] : undefined
  const marker = parent.kind === 'list' && isOrdered(parent.marker)
    || firstChild?.kind === 'list' && isOrdered(firstChild.marker)
    ? '1.'
    : '-'
  return { kind: 'list', level: 0, marker, indentText: childIndentText(parent, tabs), checkbox: null, text }
}

function makeSibling(node: SourceNode, text: string): NewNode {
  if (node.kind === 'heading')
    return { kind: 'heading', level: node.level, marker: '#'.repeat(node.level), indentText: '', checkbox: null, text }

  if (node.kind === 'paragraph')
    return { kind: 'paragraph', level: 0, marker: '', indentText: node.indentText, checkbox: null, text }

  return { kind: 'list', level: 0, marker: node.kind === 'list' ? node.marker : '-', indentText: node.indentText, checkbox: null, text }
}

/**
 * A new top-level node: a sibling of the last top-level node when there is one,
 * so an appended node looks native (same marker, heading level, indentation).
 */
function makeTopLevel(roots: SourceNode[], text: string): NewNode {
  const last = roots[roots.length - 1]
  if (last) return makeSibling(last, text)
  return { kind: 'list', level: 0, marker: '-', indentText: '', checkbox: null, text }
}

/**
 * Line index at which a child of the synthetic root is appended.
 *
 * The synthetic root (`[]`) has no source line of its own, so its children are
 * the document's top-level nodes: a new one goes right after the last of them,
 * or at the end of the document when there is none.
 */
function topLevelInsertLineFrom(lines: string[], roots: SourceNode[]): number {
  if (roots.length > 0) return roots[roots.length - 1].endLine + 1
  // Insert before the final empty line so the trailing newline is kept.
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

/**
 * Applies a single edit to `markdown` and returns the updated markdown.
 *
 * Only the lines belonging to the targeted node are touched, so frontmatter,
 * paragraphs, code blocks and any other content are preserved verbatim.
 *
 * Ordered lists are renumbered after adding/removing items because markmap
 * ignores the literal marker and displays `start + position`, so the source
 * markers must be sequential for the file and the mindmap to agree.
 */
/**
 * Where a node added below the synthetic root (source path `[]`) ends up.
 *
 * A document with no node of its own (prose only, or empty) shows the file title
 * as its root, so the new node becomes the document's first top-level node.
 * Otherwise it is appended after the last top-level node, which keeps it below
 * the title the renderer shows.
 */
export function rootChildTarget(markdown: string): { line: number, path: number[] } {
  const lines = markdown.split('\n')
  return rootChildTargetFrom(lines, parseSourceLines(lines))
}

/** {@link rootChildTarget} for callers that already have the parsed document. */
function rootChildTargetFrom(lines: string[], roots: SourceNode[]): { line: number, path: number[] } {
  return {
    line: topLevelInsertLineFrom(lines, roots),
    path: [roots.length],
  }
}

export function applyEdit(markdown: string, operation: EditOperation): string {
  const lines = markdown.split('\n')
  const roots = parseSourceLines(lines)

  // Adding below the synthetic root (`[]`) appends a new top-level node. A
  // document made of prose only (or of several headings, or a flat list) has no
  // single line to hang a child on, but must still be editable: this is how the
  // very first node of such a file gets created.
  if (operation.type === 'addChild' && operation.path.length === 0) {
    const target = rootChildTargetFrom(lines, roots)
    const last = roots[roots.length - 1]
    const line = formatLine(makeTopLevel(roots, operation.text))
    // Two paragraphs need a blank line between them; without it markdown joins
    // them into one paragraph (or treats the new line as a list continuation).
    lines.splice(target.line, 0, ...(last?.kind === 'paragraph' ? ['', line] : [line]))
    renumberIfOrdered(lines, roots, operation)
    return lines.join('\n')
  }

  const node = getNodeAtPath(roots, operation.path)

  switch (operation.type) {
    case 'setText':
      if (isBlock(node)) {
        const block = formatBlock(node, operation.text)
        lines.splice(node.line, node.endLine - node.line + 1, ...block)
      }
      else if (node.kind === 'paragraph') {
        lines.splice(node.line, node.raw?.length ?? 1, ...formatParagraph(node, operation.text))
      }
      else {
        lines[node.line] = formatLine({ ...node, text: operation.text })
      }
      break

    case 'addChild':
      lines.splice(node.endLine + 1, 0, formatLine(makeChild(node, operation.text, usesTabs(roots))))
      break

    case 'addSibling': {
      const line = formatLine(makeSibling(node, operation.text))
      // A paragraph sibling needs a blank line of its own, otherwise markdown
      // merges it into the previous paragraph.
      lines.splice(node.endLine + 1, 0, ...(node.kind === 'paragraph' ? ['', line] : [line]))
      break
    }

    case 'remove':
      lines.splice(node.line, node.endLine - node.line + 1)
      break
  }

  renumberIfOrdered(lines, roots, operation)

  return lines.join('\n')
}

/**
 * Renumbers the sibling group an edit touched, when it can hold an ordered
 * list.
 *
 * Renumbering needs the line numbers the nodes have *after* the splice, which
 * means parsing the document again. A group without a single ordered list item
 * can never need renumbering, so that second scan is skipped: adding a node is
 * on the keystroke path and this was half of its cost.
 */
function renumberIfOrdered(lines: string[], roots: SourceNode[], operation: EditOperation): void {
  const group = siblingGroup(roots, operation)
  if (!group.some(node => node.kind === 'list' && isOrdered(node.marker))) return

  renumberOrderedList(lines, siblingGroup(parseSourceLines(lines), operation))
}

export type MovePosition = 'before' | 'after' | 'child'

export interface MoveResult {
  /** The updated markdown (unchanged when the move is refused). */
  markdown: string
  /** Source line of the moved node in the result, or -1 when refused. */
  line: number
}

/** A subtree's raw lines plus its parsed root, detached from a document. */
export interface SubtreeBlock {
  /** Raw source lines of the subtree, in order. */
  lines: string[]
  /** Parsed root; its line numbers refer to the document it came from. */
  root: SourceNode
}

const MAX_HEADING_LEVEL = 6

/** Extracts a subtree so it can be re-inserted elsewhere (copy/cut). */
export function extractSubtree(markdown: string, path: number[]): SubtreeBlock | null {
  let root: SourceNode
  try {
    root = getNodeAtPath(parseSource(markdown), path)
  } catch {
    return null
  }

  return { lines: markdown.split('\n').slice(root.line, root.endLine + 1), root }
}

/** Removes a subtree, renumbering the ordered list it belonged to. */
export function removeSubtree(markdown: string, path: number[]): string {
  return removeNodes(markdown, [path])
}

/**
 * Inserts a detached subtree as the last child of `targetPath` (`child`) or as
 * its sibling (`before` / `after`).
 *
 * Only the block's own lines are rewritten: its indentation (or heading level)
 * is rebased against the destination while the *relative* structure is kept,
 * so the mindmap shape never changes. Unsupported combinations (nesting a
 * heading in a list, exceeding heading level 6) return `line: -1`.
 */
export function insertSubtree(
  markdown: string,
  targetPath: number[],
  position: MovePosition,
  block: SubtreeBlock,
): MoveResult {
  const lines = markdown.split('\n')
  const roots = parseSource(markdown)

  let target: SourceNode
  try {
    target = getNodeAtPath(roots, targetPath)
  } catch {
    return { markdown, line: -1 }
  }

  const insertAt = position === 'before' ? target.line : target.endLine + 1
  if (!spliceBlock(lines, roots, insertAt, block, target, position)) return { markdown, line: -1 }

  const finalRoots = parseSource(lines.join('\n'))
  renumberGroup(lines, findGroupByLine(finalRoots, insertAt))

  return { markdown: lines.join('\n'), line: insertAt }
}

/**
 * Rebased `block` against `target` and splices it into `lines` at `insertAt`.
 * Returns `false` (leaving `lines` untouched) for unsupported combinations.
 */
function spliceBlock(
  lines: string[],
  roots: SourceNode[],
  insertAt: number,
  block: SubtreeBlock,
  target: SourceNode,
  position: MovePosition,
): boolean {
  const rendered = renderMovedSubtree(block.lines, block.root, target, position, usesTabs(roots))
  if (!rendered) return false

  lines.splice(insertAt, 0, ...rendered)
  return true
}

/**
 * Renders a moved subtree as it should appear at its destination, or `null`
 * when the move cannot be represented.
 *
 * The normal path re-bases the subtree (heading levels and indentation). When
 * markdown cannot express the move directly - a heading cannot be nested inside
 * a list item, and ATX headings stop at level 6 - the subtree is rendered as
 * nested list items instead, keeping its shape.
 */
function renderMovedSubtree(
  rawLines: string[],
  source: SourceNode,
  target: SourceNode,
  position: MovePosition,
  tabs: boolean,
): string[] | null {
  const headingDelta = headingMoveDelta(source, target, position)
  const newRootPrefix = destinationPrefix(source, target, position, tabs)

  if (headingDelta !== null && newRootPrefix !== null) {
    const indentDelta = indentLength(newRootPrefix) - source.indent
    return rebaseSubtree(rawLines, source, headingDelta, newRootPrefix, indentDelta)
  }

  // Only a heading can hit this fallback: list items and blocks are re-based.
  if (source.kind !== 'heading') return null

  const rootIndent = position === 'child'
    ? (target.kind === 'heading' ? '' : childIndentText(target, tabs))
    : (target.kind === 'heading' ? '' : target.indentText)
  return convertSubtreeToLists(rawLines, source, rootIndent, tabs)
}

/** Indentation for the children of a list item with `marker` at `indentText`. */
function listChildIndent(indentText: string, marker: string, tabs: boolean): string {
  if (tabs) return `${indentText}\t`
  return ' '.repeat(indentLength(indentText) + marker.length + 1)
}

/**
 * Renders a heading subtree as nested list items so it can live inside a list
 * item. Headings become `-` items, list items keep their marker and checkbox,
 * and paragraphs/blocks are re-indented verbatim so nothing is lost.
 */
function convertSubtreeToLists(
  rawLines: string[],
  source: SourceNode,
  rootIndent: string,
  tabs: boolean,
): string[] {
  const nodesByLine = new Map<number, SourceNode>()
  for (const node of subtreeNodes(source)) nodesByLine.set(node.line, node)

  const indent = new Map<SourceNode, string>()
  const marker = new Map<SourceNode, string>()
  const blockDelta = new Map<SourceNode, number>()

  const walk = (node: SourceNode, indentText: string) => {
    indent.set(node, indentText)
    if (isBlock(node)) {
      blockDelta.set(node, indentLength(indentText) - node.indent)
      return
    }

    const nodeMarker = node.kind === 'list' ? node.marker : '-'
    marker.set(node, nodeMarker)

    const childIndent = listChildIndent(indentText, nodeMarker, tabs)
    for (const child of node.children) walk(child, childIndent)
  }
  walk(source, rootIndent)

  /** Deepest parsed node whose source range contains `index`. */
  const owner = (index: number): SourceNode => {
    let best = source
    const visit = (node: SourceNode) => {
      if (node.line <= index && index <= node.endLine) {
        best = node
        for (const child of node.children) visit(child)
      }
    }
    visit(source)
    return best
  }

  return rawLines.map((line, offset) => {
    const index = source.line + offset
    const node = nodesByLine.get(index)
    if (node && isBlock(node)) return shiftLine(line, blockDelta.get(node)!)

    if (node) {
      const checkbox = node.checkbox ? `[${node.checkbox}] ` : ''
      return `${indent.get(node)}${marker.get(node)} ${checkbox}${node.text}`
    }

    if (line.trim() === '') return ''

    const containing = owner(index)
    if (isBlock(containing)) return shiftLine(line, blockDelta.get(containing)!)

    // A paragraph between two nodes belongs to the enclosing node's content.
    const parentIndent = indent.get(containing) ?? rootIndent
    const parentMarker = marker.get(containing) ?? '-'
    const targetIndent = listChildIndent(parentIndent, parentMarker, tabs)
    const currentIndent = line.match(/^[ \t]*/)![0]
    return shiftLine(line, indentLength(targetIndent) - indentLength(currentIndent))
  })
}

/**
 * Moves a node (together with its whole subtree) next to or inside another
 * node, returning the rewritten markdown.
 *
 * - `child` appends the node as the last child of `target`
 * - `before` / `after` insert it as a sibling of `target` (same kind only)
 *
 * The two ordered lists the move disturbs (the one it left and the one it
 * joined) are renumbered. Unsupported moves leave the document untouched.
 */
export function moveNode(
  markdown: string,
  sourcePath: number[],
  targetPath: number[],
  position: MovePosition = 'child',
): MoveResult {
  const lines = markdown.split('\n')
  const roots = parseSource(markdown)

  let source: SourceNode
  let target: SourceNode
  try {
    source = getNodeAtPath(roots, sourcePath)
    target = getNodeAtPath(roots, targetPath)
  } catch {
    return { markdown, line: -1 }
  }

  if (samePath(sourcePath, targetPath)) return { markdown, line: -1 }
  // A node cannot be moved into itself or any of its descendants.
  if (contains(source, target)) return { markdown, line: -1 }

  const block: SubtreeBlock = {
    lines: lines.slice(source.line, source.endLine + 1),
    root: source,
  }

  // The target keeps its original line numbers until the block is spliced in,
  // so compute the destination first and only then remove the source.
  const remaining = [...lines.slice(0, source.line), ...lines.slice(source.endLine + 1)]
  let insertAt = position === 'before' ? target.line : target.endLine + 1
  if (source.endLine < insertAt) insertAt -= block.lines.length

  if (!spliceBlock(remaining, roots, insertAt, block, target, position)) return { markdown, line: -1 }

  // Renumber the two ordered lists the move may have disturbed.
  const finalRoots = parseSource(remaining.join('\n'))
  renumberGroup(remaining, findGroupByLine(finalRoots, insertAt))

  const neighbour = neighbourOf(roots, sourcePath)
  if (neighbour) {
    let line = neighbour.line
    if (line > source.line) line -= block.lines.length
    if (line >= insertAt) line += block.lines.length
    renumberGroup(remaining, findGroupByLine(finalRoots, line))
  }

  return { markdown: remaining.join('\n'), line: insertAt }
}

/**
 * Moves several nodes (with their subtrees) in a single edit.
 *
 * A selection that holds both a node and one of its descendants moves the
 * ancestor only, so nothing is duplicated. With `child` the nodes are appended
 * to `target` in document order; both the destination list and every list the
 * nodes left are renumbered. Returns `line: -1` when the move is unsupported.
 */
export function moveNodes(
  markdown: string,
  sourcePaths: number[][],
  targetPath: number[],
  position: MovePosition = 'child',
): MoveResult {
  if (sourcePaths.length === 0) return { markdown, line: -1 }
  if (sourcePaths.length === 1) return moveNode(markdown, sourcePaths[0], targetPath, position)

  const lines = markdown.split('\n')
  const roots = parseSource(markdown)

  let target: SourceNode
  const sources: { path: number[]; node: SourceNode }[] = []
  try {
    target = getNodeAtPath(roots, targetPath)
    for (const path of sourcePaths) sources.push({ path, node: getNodeAtPath(roots, path) })
  } catch {
    return { markdown, line: -1 }
  }

  // Collapse nested selections onto their outermost node and drop duplicates.
  const selected = sources
    .filter(({ node }, index) => sources.findIndex(other => other.node === node) === index)
    .filter(({ node }) => !sources.some(({ node: other }) => other !== node && contains(other, node)))
  // The target cannot be moved, nor live inside a moved subtree.
  if (selected.some(({ path, node }) => samePath(path, targetPath) || contains(node, target)))
    return { markdown, line: -1 }

  selected.sort((a, b) => a.node.line - b.node.line)

  // Rebase every block against the target *before* removing anything, so the
  // parsed line numbers still refer to the original document.
  const tabs = usesTabs(roots)
  const blocks: string[][] = []
  for (const { node } of selected) {
    const rendered = renderMovedSubtree(lines.slice(node.line, node.endLine + 1), node, target, position, tabs)
    if (!rendered) return { markdown, line: -1 }
    blocks.push(rendered)
  }

  // Remove the blocks back to front so earlier line numbers stay valid.
  for (let i = selected.length - 1; i >= 0; i--) {
    const node = selected[i].node
    lines.splice(node.line, node.endLine - node.line + 1)
  }

  const insertAt0 = position === 'before' ? target.line : target.endLine + 1
  const removedBefore = selected.reduce((total, { node }) =>
    node.endLine < insertAt0 ? total + (node.endLine - node.line + 1) : total, 0)
  const insertAt = insertAt0 - removedBefore
  const inserted = blocks.flat()
  lines.splice(insertAt, 0, ...inserted)

  // Renumber the destination list and every list that lost a node.
  const finalRoots = parseSource(lines.join('\n'))
  const groups: (SourceNode[] | null)[] = [findGroupByLine(finalRoots, insertAt)]
  for (const { path } of selected) {
    const parentPath = path.slice(0, -1)
    const group = parentPath.length === 0 ? roots : getNodeAtPath(roots, parentPath).children
    const survivor = group.find(candidate => !selected.some(({ node }) => node === candidate))
    if (survivor)
      groups.push(findGroupByLine(finalRoots, mapFinalLine(survivor.line, selected, insertAt, inserted.length)))
  }
  for (const group of groups) renumberGroup(lines, group)

  return { markdown: lines.join('\n'), line: insertAt }
}

/** Maps a line of the original document to its line after a batch move. */
function mapFinalLine(
  line: number,
  selected: { node: SourceNode }[],
  insertAt: number,
  insertedLength: number,
): number {
  const removedBefore = selected.reduce((total, { node }) =>
    node.endLine < line ? total + (node.endLine - node.line + 1) : total, 0)
  const mapped = line - removedBefore
  return mapped >= insertAt ? mapped + insertedLength : mapped
}

/** Heading-level shift for a heading move, or `null` when it is unsupported. */
function headingMoveDelta(source: SourceNode, target: SourceNode, position: MovePosition): number | null {
  if (source.kind !== 'heading') return 0
  if (target.kind !== 'heading') return null

  const level = position === 'child' ? target.level + 1 : target.level
  if (level < 1 || level > MAX_HEADING_LEVEL) return null

  const delta = level - source.level
  return maxHeadingLevel(source) + delta <= MAX_HEADING_LEVEL ? delta : null
}

/** Leading whitespace for the moved root, or `null` when unsupported. */
function destinationPrefix(source: SourceNode, target: SourceNode, position: MovePosition, tabs: boolean): string | null {
  if (position !== 'child') {
    if (target.kind !== source.kind) return null
    return target.kind === 'heading' ? '' : target.indentText
  }

  // Headings never carry indentation, so a child of a heading is unindented.
  if (target.kind === 'heading') return ''
  // A heading cannot become a child of a list item.
  if (source.kind === 'heading') return null

  return childIndentText(target, tabs)
}

function maxHeadingLevel(node: SourceNode): number {
  const own = node.kind === 'heading' ? node.level : 0
  return node.children.reduce((max, child) => Math.max(max, maxHeadingLevel(child)), own)
}

function subtreeNodes(node: SourceNode): SourceNode[] {
  return [node, ...node.children.flatMap(subtreeNodes)]
}

function indentLength(indentText: string): number {
  return indentText.replace(/\t/g, '    ').length
}

/** Re-indents a single line, keeping tabs when the result is tab-aligned. */
function shiftIndent(indentText: string, delta: number): string {
  if (delta === 0) return indentText

  const target = indentLength(indentText) + delta
  if (target <= 0) return ''
  if (indentText.includes('\t') && target % 4 === 0) return '\t'.repeat(target / 4)
  return ' '.repeat(target)
}

/**
 * Rewrites the moved subtree's lines in place. Parsed node lines get a new
 * heading level / indentation; anything else (paragraphs, ...) is kept
 * verbatim. Opaque blocks (code/table) are re-indented line by line so their
 * own relative structure survives.
 */
function rebaseSubtree(
  lines: string[],
  source: SourceNode,
  headingDelta: number,
  newRootPrefix: string,
  indentDelta: number,
): string[] {
  const nodesByLine = new Map<number, SourceNode>()
  const blockLines = new Set<number>()
  for (const node of subtreeNodes(source)) {
    nodesByLine.set(node.line, node)
    if (isBlock(node))
      for (let line = node.line; line <= node.endLine; line++) blockLines.add(line)
    else if (node.kind === 'paragraph')
      for (let line = node.line; line < node.line + (node.raw?.length ?? 1); line++) blockLines.add(line)
  }

  return lines.map((line, offset) => {
    const index = source.line + offset
    if (blockLines.has(index)) return shiftLine(line, indentDelta)

    const node = nodesByLine.get(index)
    if (!node) return line

    if (node.kind === 'heading') {
      const level = node.level + headingDelta
      return formatLine({ ...node, level, marker: '#'.repeat(level) })
    }

    const indentText = node === source ? newRootPrefix : shiftIndent(node.indentText, indentDelta)
    return formatLine({ ...node, indentText })
  })
}

/** Shifts the leading whitespace of a single line by `delta` spaces. */
function shiftLine(line: string, delta: number): string {
  if (delta === 0) return line
  const indent = line.match(/^[ \t]*/)![0]
  return shiftIndent(indent, delta) + line.slice(indent.length)
}

/** Sibling group (children of the same parent) containing `line`. */
function findGroupByLine(nodes: SourceNode[], line: number): SourceNode[] | null {
  for (const node of nodes) {
    if (node.line === line) return nodes
    if (node.line < line && line <= node.endLine) {
      const found = findGroupByLine(node.children, line)
      if (found) return found
    }
  }
  return null
}

/** Sibling next to `path` in the original tree (following, else preceding). */
function neighbourOf(roots: SourceNode[], path: number[]): SourceNode | undefined {
  const parentPath = path.slice(0, -1)
  const index = path[path.length - 1]
  const group = parentPath.length === 0 ? roots : getNodeAtPath(roots, parentPath).children
  return group[index + 1] ?? group[index - 1]
}

function renumberGroup(lines: string[], group: SourceNode[] | null): void {
  if (group) renumberOrderedList(lines, group)
}

/** Pre-order list of all node paths in the tree. */
export function flattenPaths(nodes: SourceNode[], prefix: number[] = []): number[][] {
  return nodes.flatMap((node, index) => {
    const path = [...prefix, index]
    return [path, ...flattenPaths(node.children, path)]
  })
}

/**
 * Path of the source node that starts on `line`, or `undefined`.
 *
 * Used to turn a move result (which reports the insertion *line*) back into a
 * tree path so the renderer can apply the move incrementally (`remove` + `insert`
 * edits) instead of re-rendering the whole tree.
 */
export function pathAtLine(nodes: SourceNode[], line: number): number[] | undefined {
  const walk = (roots: SourceNode[], prefix: number[]): number[] | undefined => {
    for (const [index, node] of roots.entries()) {
      const path = [...prefix, index]
      if (node.line === line) return path
      const nested = walk(node.children, path)
      if (nested) return nested
    }
    return undefined
  }
  return walk(nodes, [])
}

/** Pre-order range between two paths, inclusive. */
export function pathRange(nodes: SourceNode[], from: number[], to: number[]): number[][] {
  const paths = flattenPaths(nodes)
  const start = paths.findIndex(path => samePath(path, from))
  const end = paths.findIndex(path => samePath(path, to))

  if (start < 0 || end < 0) return [to]
  return paths.slice(Math.min(start, end), Math.max(start, end) + 1)
}

/**
 * Removes several nodes at once.
 *
 * Nodes contained in another selected node's subtree are removed only once, and
 * removals run from the end of the document so the remaining paths stay valid.
 */
export function removeNodes(markdown: string, paths: number[][]): string {
  if (paths.length === 0) return markdown

  const lines = markdown.split('\n')
  const roots = parseSourceLines(lines)
  const candidates = paths.map(path => ({ path, node: getNodeAtPath(roots, path) }))
    .sort((a, b) => a.node.line - b.node.line)
  const selected: typeof candidates = []
  for (const candidate of candidates) {
    const previous = selected[selected.length - 1]
    // Source subtrees are contiguous ranges: after sorting, the previous
    // outermost range is enough to discard duplicates and descendants.
    if (!previous || candidate.node.line > previous.node.endLine) selected.push(candidate)
  }

  const affected = new Set<SourceNode[]>()
  for (const { path } of selected) {
    const parentPath = path.slice(0, -1)
    affected.add(parentPath.length === 0 ? roots : getNodeAtPath(roots, parentPath).children)
  }

  // Copy surviving lines once instead of parsing/splicing/joining the whole
  // document separately for each selected node. The map also lets ordered
  // siblings be renumbered without a second parse of the edited document.
  const finalLines: string[] = []
  const lineMap = new Int32Array(lines.length).fill(-1)
  let range = 0
  for (let line = 0; line < lines.length; line++) {
    while (range < selected.length && selected[range].node.endLine < line) range++
    if (range < selected.length && selected[range].node.line <= line) continue
    lineMap[line] = finalLines.length
    finalLines.push(lines[line])
  }

  for (const group of affected) {
    const survivors = group.filter(node => node.kind === 'list' && lineMap[node.line] >= 0)
    if (!survivors.length || !survivors.every(node => isOrdered(node.marker))) continue
    survivors.forEach((node, index) => {
      finalLines[lineMap[node.line]] = formatLine({ ...node, marker: `${index + 1}.` })
    })
  }
  return finalLines.join('\n')
}

function contains(outer: SourceNode, inner: SourceNode): boolean {
  return outer.line <= inner.line && inner.endLine <= outer.endLine
}

export function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * A string that uniquely identifies a path, so paths can be looked up in a `Set`
 * or `Map` instead of scanning a list with `samePath` for every rendered node.
 */
export function pathKey(path: number[]): string {
  return path.join('.')
}

/** Sibling group that may need renumbering after an edit. */
function siblingGroup(roots: SourceNode[], operation: EditOperation): SourceNode[] {
  if (operation.type === 'addChild') {
    // The synthetic root's children are the document's top-level nodes.
    if (operation.path.length === 0) return roots
    return getNodeAtPath(roots, operation.path).children
  }

  const parentPath = operation.path.slice(0, -1)
  return parentPath.length === 0
    ? roots
    : getNodeAtPath(roots, parentPath).children
}

function renumberOrderedList(lines: string[], group: SourceNode[]): void {
  // A prose paragraph can sit next to the list as a sibling; it does not take
  // part in list numbering.
  const lists = group.filter(node => node.kind === 'list')
  if (lists.length === 0) return
  if (!lists.every(node => isOrdered(node.marker))) return

  // Always start at 1. A (sub-)list whose first item is not `1.` cannot
  // interrupt the parent's paragraph, so markdown-it would absorb it as text
  // instead of nesting it (e.g. `4. parent\n    2. child`).
  lists.forEach((node, index) => {
    lines[node.line] = formatLine({ ...node, marker: `${index + 1}.` })
  })
}
