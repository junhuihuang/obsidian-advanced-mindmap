interface NodeData {
  children?: unknown[]
}

/**
 * Removes the fold circle from nodes that no longer have children.
 *
 * markmap-view binds the circle to the node's children
 * (`data(d => d.children?.length ? [d] : [])`) but never removes its exit
 * selection, so deleting all children of a node leaves a stale circle at the
 * end of the node's line. Exiting `g` elements are cleaned up by markmap; this
 * only handles nodes that stay but lost their children.
 */
export function removeChildlessCircles(svg: SVGSVGElement): void {
  for (const group of Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))) {
    const data = (group as unknown as { __data__?: NodeData }).__data__
    if (!data || data.children?.length) continue

    group.querySelector(':scope > circle')?.remove()
  }
}
