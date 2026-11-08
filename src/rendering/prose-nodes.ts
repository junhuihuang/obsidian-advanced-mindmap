import type { IPureNode } from 'markmap-common'

import { getSourcePath, SOURCE_PATH_KEY } from 'src/editing/source-paths'
import { pathKey, type SourceNode } from 'src/editing/source-tree'


/** Renders a paragraph's inline markdown the same way markmap renders node text. */
export type RenderInline = (markdown: string) => string

interface SourceEntry {
  node: SourceNode
  path: number[]
}

export interface ProseNodeOptions {
  /**
   * Insert only the paragraphs that introduce a rendered block (a list, a table,
   * a code block) and leave plain prose out — the canvas's `smart` prose mode.
   * `1.` / `-` / `|` in front of a paragraph is not plain text, and the block
   * would lose its context without that line.
   */
  structuralOnly?: boolean
}

/**
 * Turns prose paragraphs into real markmap nodes.
 *
 * markmap only renders headings, lists, code blocks and tables, so plain
 * paragraphs are normally dropped (or left as an empty list wrapper). Once
 * `parseSource` has marked every paragraph as a node, this inserts those nodes
 * into the already transformed markmap tree. A paragraph keeps any renderable
 * block below it as its children, so prose can introduce a list.
 *
 * The tree must already be tagged with source paths (`tagSourcePaths`).
 */
export function insertProseNodes(
  root: IPureNode,
  roots: SourceNode[],
  renderInline: RenderInline,
  { structuralOnly = false }: ProseNodeOptions = {},
): void {
  // markmap collapses a synthetic root that has only one rendered child. When
  // other top-level nodes are paragraphs (which markmap dropped), that collapsed
  // node would swallow those paragraphs. Give the document a real synthetic
  // root first so every top-level node has somewhere to go.
  const rootPath = getSourcePath(root)
  if (roots.length > 1 && rootPath && rootPath.length > 0) wrapInSyntheticRoot(root)

  const byPath = new Map<string, IPureNode>()
  collectRenderedPaths(root, byPath)

  const sourceEntries: SourceEntry[] = []
  const sourcePath = new Map<SourceNode, number[]>()
  collectSourceEntries(roots, [], sourceEntries, sourcePath)

  // Paragraphs whose subtree holds something markmap drew: those are the ones an
  // `structuralOnly` run keeps.
  const withBlock = new Set<string>()
  if (structuralOnly) {
    for (const { node, path } of sourceEntries) {
      if (node.kind === 'paragraph' && hasRenderedBlock(node, path, byPath)) withBlock.add(pathKey(path))
    }
  }

  for (const { node, path } of sourceEntries) {
    if (node.kind !== 'paragraph') continue
    if (structuralOnly && !withBlock.has(pathKey(path))) continue

    const parentPath = path.slice(0, -1)
    const parent = byPath.get(pathKey(parentPath))
    if (!parent) {
      // markmap collapses a synthetic root that has only one child, so for a
      // single list item / code block the rendered root *is* the paragraph's
      // child. Wrap that node in the paragraph so the root becomes the
      // paragraph instead of disappearing.
      const rootPath = getSourcePath(root)
      if (parentPath.length !== 0 || !rootPath || !isDescendant(path, rootPath)) continue

      const previous: IPureNode = {
        content: root.content,
        children: root.children,
        payload: root.payload,
      }
      const paragraph = makeParagraph(node, path, [previous], renderInline)
      root.content = paragraph.content
      root.children = paragraph.children
      root.payload = paragraph.payload
      byPath.set(pathKey(rootPath), previous)
      byPath.set(pathKey(path), root)
      continue
    }

    const children: IPureNode[] = []
    const tops: IPureNode[] = []

    for (const child of node.children) {
      const childPath = sourcePath.get(child)
      const rendered = childPath ? byPath.get(pathKey(childPath)) : undefined
      const top = rendered ? topChildContaining(parent, rendered) : null
      if (!rendered || !top) continue
      children.push(rendered)
      if (!tops.includes(top)) tops.push(top)
    }

    // Every paragraph is a node, even when markmap rendered nothing for it
    // (plain prose, or prose whose list was empty). Nodes with rendered children
    // take the place of the first child; bare prose is inserted by source order.
    const positions = tops
      .map(top => parent.children.indexOf(top))
      .filter(index => index >= 0)
    const insertAt = positions.length > 0 ? Math.min(...positions) : insertionIndex(parent, path)

    // markmap renders a paragraph whose only content is an image as a node of
    // its own (`p>img:only-child`). That node *is* the paragraph: adding the
    // paragraph next to it would draw the same line of the document twice.
    const own = byPath.get(pathKey(path))
    const rendered = own && parent.children.includes(own) ? own : undefined

    for (const child of children) detach(parent, child)
    for (const top of tops) {
      if (children.includes(top) || !parent.children.includes(top)) continue
      pruneEmpty(top)
      if (top.children.length === 0) parent.children.splice(parent.children.indexOf(top), 1)
    }

    // Reuse the rendered node in place: it already sits at the paragraph's
    // source position. Its content is re-rendered from the whole paragraph so
    // text next to the image (which markmap drops) stays visible.
    if (rendered) {
      rendered.content = renderInline(node.text)
      rendered.children = children
      byPath.set(pathKey(path), rendered)
      continue
    }

    const paragraph = makeParagraph(node, path, children, renderInline)
    parent.children.splice(insertAt, 0, paragraph)
    byPath.set(pathKey(path), paragraph)
  }
}

/**
 * Flattens the empty wrappers markmap leaves behind for a plain paragraph that
 * introduces a list (`<p>` followed by `<ul>`): they carry no source path and no
 * text, only the list.
 *
 * Nothing fills one in when the canvas draws no paragraph there, so it would be
 * painted as an empty node — and one revealed level of `l` lands on it, which
 * cannot be selected, so the cursor would not move at all. Its children take its
 * place.
 *
 * Only for `prose: false`: `insertProseNodes` turns these same wrappers into the
 * paragraph's node.
 */
export function dropEmptyWrappers(node: IPureNode): void {
  node.children = node.children.flatMap(child => {
    dropEmptyWrappers(child)
    const wrapper = child.content === '' && !getSourcePath(child)
    return wrapper ? child.children : [child]
  })
}

/** Does anything below `node` end up in the rendered tree? */
function hasRenderedBlock(node: SourceNode, path: number[], byPath: Map<string, IPureNode>): boolean {
  return node.children.some((child, index) => {
    const childPath = [...path, index]
    return byPath.has(pathKey(childPath)) || hasRenderedBlock(child, childPath, byPath)
  })
}

function wrapInSyntheticRoot(root: IPureNode): void {
  const previous: IPureNode = {
    content: root.content,
    children: root.children,
    payload: root.payload,
  }
  root.content = ''
  root.children = [previous]
  root.payload = { [SOURCE_PATH_KEY]: [] }
}

/** Position of a bare paragraph among the rendered children, by source order. */
function insertionIndex(parent: IPureNode, path: number[]): number {
  for (const [index, child] of parent.children.entries()) {
    const childPath = minimumSourcePath(child)
    if (childPath && comparePaths(childPath, path) > 0) return index
  }
  return parent.children.length
}

function minimumSourcePath(node: IPureNode): number[] | undefined {
  let best = getSourcePath(node)
  for (const child of node.children) {
    const path = minimumSourcePath(child)
    if (path && (!best || comparePaths(path, best) < 0)) best = path
  }
  return best
}

function comparePaths(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

function makeParagraph(node: SourceNode, path: number[], children: IPureNode[], renderInline: RenderInline): IPureNode {
  return {
    content: renderInline(node.text),
    children,
    payload: {
      [SOURCE_PATH_KEY]: path,
      lines: `${node.line},${node.line + (node.raw?.length ?? 1)}`,
    },
  }
}

function isDescendant(ancestor: number[], path: number[]): boolean {
  return path.length > ancestor.length && ancestor.every((value, index) => value === path[index])
}

function collectRenderedPaths(node: IPureNode, byPath: Map<string, IPureNode>): void {
  const path = getSourcePath(node)
  if (path) byPath.set(pathKey(path), node)
  node.children.forEach(child => collectRenderedPaths(child, byPath))
}

function collectSourceEntries(
  nodes: SourceNode[],
  prefix: number[],
  entries: SourceEntry[],
  paths: Map<SourceNode, number[]>,
): void {
  for (const [index, node] of nodes.entries()) {
    const path = [...prefix, index]
    entries.push({ node, path })
    paths.set(node, path)
    collectSourceEntries(node.children, path, entries, paths)
  }
}

/** First child of `parent` whose subtree contains `target`. */
function topChildContaining(parent: IPureNode, target: IPureNode): IPureNode | null {
  for (const child of parent.children) {
    if (child === target || containsNode(child, target)) return child
  }
  return null
}

function containsNode(outer: IPureNode, inner: IPureNode): boolean {
  if (outer === inner) return true
  return outer.children.some(child => containsNode(child, inner))
}

/** Removes `target` from wherever it sits inside `parent`'s subtree. */
function detach(parent: IPureNode, target: IPureNode): void {
  const index = parent.children.indexOf(target)
  if (index >= 0) {
    parent.children.splice(index, 1)
    return
  }
  parent.children.forEach(child => detach(child, target))
}

/** Drops structural wrappers that no longer hold anything after re-parenting. */
function pruneEmpty(node: IPureNode): void {
  node.children = node.children.filter(child => {
    pruneEmpty(child)
    return !!getSourcePath(child) || child.children.length > 0 || child.content !== ''
  })
}
