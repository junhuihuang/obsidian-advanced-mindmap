// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { removeChildlessCircles } from './node-circles'


const SVG_NS = 'http://www.w3.org/2000/svg'

function makeSvg(): SVGSVGElement {
  return document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
}

function makeNode(children: unknown[]): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.classList.add('markmap-node')
  group.appendChild(document.createElementNS(SVG_NS, 'circle'))
  ;(group as unknown as { __data__: unknown }).__data__ = { children }
  return group as unknown as SVGGElement
}

describe('removeChildlessCircles', () => {
  it('removes the circle from nodes without children', () => {
    const svg = makeSvg()
    const parent = makeNode([{}])
    const leaf = makeNode([])
    svg.append(parent, leaf)

    removeChildlessCircles(svg)

    expect(parent.querySelector('circle')).not.toBeNull()
    expect(leaf.querySelector('circle')).toBeNull()
  })

  it('keeps the circle for folded nodes that still have children', () => {
    const svg = makeSvg()
    const folded = makeNode([{}, {}])
    svg.append(folded)

    removeChildlessCircles(svg)

    expect(folded.querySelector('circle')).not.toBeNull()
  })

  it('ignores nodes without bound data', () => {
    const svg = makeSvg()
    const group = document.createElementNS(SVG_NS, 'g')
    group.classList.add('markmap-node')
    group.appendChild(document.createElementNS(SVG_NS, 'circle'))
    svg.appendChild(group)

    expect(() => removeChildlessCircles(svg)).not.toThrow()
    expect(group.querySelector('circle')).not.toBeNull()
  })

  it('does not touch the node other children', () => {
    const svg = makeSvg()
    const leaf = makeNode([])
    const line = document.createElementNS(SVG_NS, 'line')
    leaf.insertBefore(line, leaf.firstChild)
    svg.append(leaf)

    removeChildlessCircles(svg)

    expect(leaf.querySelector('line')).not.toBeNull()
    expect(leaf.querySelector('circle')).toBeNull()
  })
})
