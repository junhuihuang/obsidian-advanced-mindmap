// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Markmap } from 'markmap-view'
import type { INode, IPureNode } from 'markmap-common'
import { revealAll, revealOneLevel } from 'src/editing/fold'
import { recenterOnCircleClick } from 'src/rendering/fold-click'

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

function tree(): IPureNode {
  return {
    content: 'root',
    payload: {},
    children: [
      { content: 'a', payload: {}, children: [{ content: 'a1', payload: {}, children: [] }] },
      { content: 'b', payload: {}, children: [] },
    ],
  }
}

describe('markmap fold via renderData', () => {
  it('hides descendants after setting payload.fold and re-rendering', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    document.body.append(svg)
    const markmap = Markmap.create(svg as unknown as SVGSVGElement, { duration: 0, embedGlobalCSS: false })
    // jsdom cannot interpolate SVG transforms; apply attributes synchronously.
    markmap.transition = (sel: unknown) => sel as never
    await markmap.setData(tree())

    const count = () => svg.querySelectorAll('g.markmap-node').length
    expect(count()).toBe(4)

    const root = markmap.state.data as IPureNode
    root.payload = { ...root.payload, fold: 1 }
    await markmap.renderData()

    expect(count()).toBe(1)
  })

  it('reveals exactly one level when a folded node is unfolded via revealOneLevel', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    document.body.append(svg)
    const markmap = Markmap.create(svg as unknown as SVGSVGElement, { duration: 0, embedGlobalCSS: false })
    markmap.transition = (sel: unknown) => sel as never

    const root: IPureNode = {
      content: 'root',
      payload: { fold: 1 },
      children: [
        { content: 'a', payload: {}, children: [{ content: 'a1', payload: {}, children: [] }] },
        { content: 'b', payload: {}, children: [] },
      ],
    }
    await markmap.setData(root)

    const count = () => svg.querySelectorAll('g.markmap-node').length
    expect(count()).toBe(1)

    revealOneLevel(root)
    await markmap.renderData()

    // root + its two direct children; `a1` stays hidden because `a` is folded.
    expect(count()).toBe(3)
  })

  it('reveals the whole subtree when revealAll is used', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    document.body.append(svg)
    const markmap = Markmap.create(svg as unknown as SVGSVGElement, { duration: 0, embedGlobalCSS: false })
    markmap.transition = (sel: unknown) => sel as never

    const root: IPureNode = {
      content: 'root',
      payload: { fold: 1 },
      children: [
        { content: 'a', payload: {}, children: [{ content: 'a1', payload: {}, children: [] }] },
      ],
    }
    await markmap.setData(root)

    const count = () => svg.querySelectorAll('g.markmap-node').length
    expect(count()).toBe(1)

    revealAll(root)
    await markmap.renderData()

    // root + `a` + `a1`, the whole subtree.
    expect(count()).toBe(3)
  })
})

describe('circle-click fold recenter', () => {
  it('toggles the node and re-centers it once the render settles', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    document.body.append(svg)
    const markmap = Markmap.create(svg as unknown as SVGSVGElement, { duration: 0, embedGlobalCSS: false })
    markmap.transition = (sel: unknown) => sel as never
    await markmap.setData(tree())

    const toggle = vi.spyOn(markmap, 'toggleNode')
    const recenter = vi.fn()
    recenterOnCircleClick(markmap, recenter)

    const node = (markmap.state.data as IPureNode).children![0] as unknown as INode
    markmap.handleClick(new MouseEvent('click'), node)
    // `toggleNode` awaits a `requestAnimationFrame` before it resolves.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(toggle).toHaveBeenCalledTimes(1)
    expect(recenter).toHaveBeenCalledTimes(1)
    expect(recenter).toHaveBeenCalledWith(node)
  })
})
