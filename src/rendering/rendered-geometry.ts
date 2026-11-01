import type { INode } from 'markmap-common'
import type { Markmap } from 'markmap-view'
import { contentCenter, type ZoomAnchor, type ZoomRect } from './zoom'

/** One scan of currently rendered nodes; hidden nodes may retain stale rects. */
function renderedNodes(markmap: Markmap): Set<INode> {
  const nodes = new Set<INode>()
  markmap.g.selectAll<SVGGElement, INode>('g.markmap-node').each(node => { nodes.add(node) })
  return nodes
}

/** Avoid calling markmap.findElement (a full DOM scan) for every descendant. */
export function renderedTreeCenter(markmap: Markmap, root: INode): ZoomAnchor | undefined {
  const rendered = renderedNodes(markmap)
  const rects: ZoomRect[] = []
  const walk = (node: INode) => {
    if (!rendered.has(node)) return
    if (node.state?.rect) rects.push(node.state.rect)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return contentCenter(rects)
}

export function renderedNodeRect(markmap: Markmap, node: INode): ZoomRect | undefined {
  return renderedNodes(markmap).has(node) ? node.state?.rect : undefined
}
