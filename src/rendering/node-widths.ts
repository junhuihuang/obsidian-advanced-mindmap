import type { IPureNode } from 'markmap-common'

import { getSourcePath } from 'src/editing/source-paths'
import { flattenPaths, getNodeAtPath, pathKey, type SourceNode } from 'src/editing/source-tree'
import type { NodeWidths } from 'src/settings/filesystem'


/** Narrowest and widest node box a mouse resize can produce, in content pixels. */
export const MIN_NODE_WIDTH = 40
export const MAX_NODE_WIDTH = 2000

/** Node payload key holding the width key, used to look the width up in the store. */
export const NODE_WIDTH_KEY = 'advmmWidthKey'

/** Rounds and clamps a dragged width so the stored value is always sane. */
export function clampNodeWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_NODE_WIDTH
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.round(width)))
}

interface NodeWidthData {
  payload?: Record<string, unknown>
}

/** The label element markmap measures to size a node (`foreignObject > div > div`). */
export function nodeLabel(group: Element): HTMLElement | null {
  return (group.querySelector('foreignObject')?.firstElementChild?.firstElementChild as HTMLElement | null) ?? null
}

/**
 * Text a width key is derived from: node params and other HTML comments are
 * ignored, so colour/fold params and legacy width comments do not change it.
 */
export function normalizedNodeText(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Stable key for a node's width, derived from its text.
 *
 * A hash keeps the settings file small (code blocks can be long) and lets the
 * width follow a node when it is moved or its siblings are reordered. Nodes with
 * identical text are told apart by `occurrence` (their index among them, in
 * document order), so two `TODO` items can have different widths.
 */
export function nodeWidthKeyForText(text: string, occurrence = 0): string {
  const base = fnv1a(normalizedNodeText(text))
  return occurrence === 0 ? base : `${base}-${occurrence}`
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Tags every rendered node with the width key of the source node it came from.
 *
 * Runs once per transform, in document order, so the duplicate-text occurrence
 * numbers match between the two calls (`tagNodeWidthKeys` and `applyNodeWidths`)
 * even though markmap may reorder or collapse nodes. Render-only nodes (the
 * synthetic root and the note title wrapper) have no source line and therefore
 * no key, which is also why they can never be resized.
 */
export function tagNodeWidthKeys(root: IPureNode, sourceRoots: SourceNode[]) {
  const rendered = new Map<string, IPureNode>()
  const visit = (node: IPureNode) => {
    const path = getSourcePath(node)
    if (path) rendered.set(pathKey(path), node)
    for (const child of node.children) visit(child)
  }
  visit(root)

  const occurrences = new Map<string, number>()
  for (const path of flattenPaths(sourceRoots)) {
    const source = getNodeAtPath(sourceRoots, path)
    const base = normalizedNodeText(source.text)
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)

    const node = rendered.get(pathKey(path))
    if (!node) continue
    node.payload = {
      ...node.payload,
      [NODE_WIDTH_KEY]: nodeWidthKeyForText(source.text, occurrence),
    }
  }
}

/** The width key stored on a rendered node, if it maps back to a source line. */
export function nodeWidthKey(group: Element): string | undefined {
  const payload = (group as unknown as { __data__?: NodeWidthData }).__data__?.payload
  const key = payload?.[NODE_WIDTH_KEY]
  return typeof key === 'string' && key.length > 0 ? key : undefined
}

/** The fixed content width stored for a node, if any. */
export function nodeWidth(group: Element, widths: NodeWidths): number | undefined {
  const key = nodeWidthKey(group)
  const width = key ? widths[key] : undefined
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : undefined
}

/**
 * Applies every node's own width to its label.
 *
 * markmap lays a node out from the label's measured `scrollWidth`, so an inline
 * `width` on the inner div both fixes the box for short text and wraps long
 * text at that width. markmap's ResizeObserver then re-runs the layout and moves
 * the node's children/links with it. Nodes without a stored width get the global
 * `maxWidth` behaviour back (the inline style is removed).
 *
 * Returns `true` when any label changed, so the caller can re-run markmap's
 * layout immediately instead of waiting for its 100 ms ResizeObserver debounce.
 */
export function applyNodeWidths(svg: SVGSVGElement, widths: NodeWidths): boolean {
  let changed = false

  for (const group of Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))) {
    const label = nodeLabel(group)
    if (!label) continue

    const width = nodeWidth(group, widths)
    if (width === undefined) {
      if (label.style.width) {
        label.style.removeProperty('width')
        changed = true
      }
    } else if (label.style.width !== `${width}px`) {
      label.setCssStyles({ width: `${width}px` })
      changed = true
    }
  }

  return changed
}
