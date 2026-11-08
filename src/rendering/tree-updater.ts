import type { INode, IPureNode } from 'markmap-common'
import type { IMarkmapOptions, Markmap } from 'markmap-view'

import { getSourcePath } from 'src/editing/source-paths'
import { pathKey } from 'src/editing/source-tree'

/** Exact source operations, not a text/content heuristic (duplicate labels are valid). */
export type TreeEdit = { type: 'insert' | 'setText' | 'remove'; path: number[] }
export type TreeChangeListener = (before: string, after: string, edits: TreeEdit[]) => void

/**
 * Turns one node's HTML (markmap renders node content to HTML) into DOM nodes.
 *
 * `DOMParser` builds an inert document, so no script or handler in the markup
 * starts while the label is updated in place.
 */
function parseContent(html: string): Node[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.body.childNodes)
}

/**
 * Reuses markmap data objects and D3 keys for editor-originated insertions and
 * renames. Only new labels enter the DOM; unchanged foreignObjects are retained.
 * Markmap still lays out visible nodes, since adding a row can move its neighbours.
 * External/untracked changes and settings/file switches use the normal setData.
 */
export function createTreeUpdater(markmap: Markmap) {
  let renderedMarkdown: string | undefined
  let renderedScope: string | undefined
  let pending: { before: string; after: string; edits: TreeEdit[] }[] = []

  function recordChange(before: string, after: string, edits: TreeEdit | TreeEdit[]) {
    pending.push({ before, after, edits: Array.isArray(edits) ? edits : [edits] })
  }

  function isCurrent(markdown: string, scope: string) {
    return renderedScope === scope && renderedMarkdown === markdown && !!markmap.state.data
  }

  async function update(
    root: IPureNode,
    options: Partial<IMarkmapOptions>,
    markdown: string,
    scope: string,
    { restructure = false }: { restructure?: boolean } = {},
  ) {
    const sameScope = renderedScope === scope && !!markmap.state.data
    if (sameScope && markdown === renderedMarkdown && !restructure) return

    let cursor = renderedMarkdown
    const edits: TreeEdit[] = []
    let consumed = 0
    for (const change of pending) {
      if (change.before !== cursor) break
      edits.push(...change.edits)
      cursor = change.after
      consumed++
      if (cursor === markdown) break
    }
    // A structural toggle (a per-canvas switch that decides which nodes exist,
    // e.g. "show plain text") changes the tree while the markdown and the scope
    // stay the same. Reconcile the fresh tree onto the live one: `setData()`
    // would reset every fold, while a path-keyed merge keeps the DOM and the
    // fold of every node that survives — and re-parents the children of a node
    // that disappears.
    const structural = restructure && sameScope
    const incremental = !structural && sameScope && consumed > 0 && cursor === markdown
    pending = incremental ? pending.slice(consumed) : []
    renderedMarkdown = markdown
    renderedScope = scope
    try {
      if (structural || incremental) {
        reconcile(markmap, root, structural ? [] : edits)
        await markmap.renderData()
      } else {
        await markmap.setData(root, options)
      }
    } catch (error) {
      // A failed layout must not make a retry look like a redundant render.
      renderedMarkdown = undefined
      pending = []
      throw error
    }
  }

  return { recordChange, update, isCurrent }
}

function shiftedPath(original: number[], edits: TreeEdit[]): number[] {
  const path = [...original]
  for (const edit of edits) {
    const depth = edit.path.length - 1
    if (path.length <= depth) continue
    if (edit.path.slice(0, depth).every((index, i) => path[i] === index)) {
      if (edit.type === 'insert' && path[depth] >= edit.path[depth]) {
        path[depth]++
      }
      else if (edit.type === 'remove' && path[depth] > edit.path[depth]) {
        path[depth]--
      }
    }
  }
  return path
}

function reconcile(markmap: Markmap, fresh: IPureNode, edits: TreeEdit[]) {
  const existing = new Map<string, INode>()
  let nextId = 0
  const collect = (node: INode) => {
    nextId = Math.max(nextId, node.state.id)
    const path = getSourcePath(node)
    if (path) existing.set(pathKey(shiftedPath(path, edits)), node)
    node.children.forEach(collect)
  }
  collect(markmap.state.data!)

  const groups = new Map<INode, SVGGElement>()
  markmap.svg.node()?.querySelectorAll<SVGGElement>('g.markmap-node').forEach(group => {
    groups.set((group as unknown as { __data__: INode }).__data__, group)
  })
  const inserted = edits.flatMap((edit, index) => edit.type === 'insert'
    ? [shiftedPath(edit.path, edits.slice(index + 1))] : [])

  function merge(node: IPureNode, parent?: INode): INode {
    const path = getSourcePath(node)
    const old = path ? existing.get(pathKey(path)) : undefined
    const depth = (parent?.state.depth ?? 0) + 1
    const id = old?.state.id ?? ++nextId
    const statePath = [parent?.state.path, id].filter(Boolean).join('.')
    const result: INode = old ?? {
      ...node,
      children: [],
      state: {
        id, key: `advmm-${id}`, path: statePath, depth,
        size: [0, 0], rect: { x: 0, y: 0, width: 0, height: 0 },
      },
    }
    const group = old ? groups.get(old) : undefined
    if (old && old.content !== node.content) {
      // renderData creates HTML only for entering nodes. Update this one label
      // in place, preserving its observed content element and all other labels.
      const label = group?.querySelector('foreignObject')?.firstElementChild?.firstElementChild
      if (label) label.replaceChildren(...parseContent(node.content))
    }
    result.content = node.content
    result.payload = { ...node.payload, ...(old ? { fold: old.payload?.fold ?? 0 } : {}) }
    // Inserting into a folded parent must expose the new node, but must not
    // expand other children or grandchildren (including nested folded nodes).
    if (path && inserted.some(target => path.length < target.length && path.every((p, i) => p === target[i]))) {
      result.payload.fold = 0
    }
    result.state.depth = depth
    result.state.path = statePath
    if (group) {
      if (group.getAttribute('data-depth') !== String(depth)) group.setAttribute('data-depth', String(depth))
      if (group.getAttribute('data-path') !== statePath) group.setAttribute('data-path', statePath)
    }
    markmap.options.color(result)
    result.children = node.children.map(child => merge(child, result))
    return result
  }

  markmap.state.data = merge(fresh)
}
