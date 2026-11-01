// @vitest-environment jsdom
import type { IPureNode } from 'markmap-common'
import { afterEach, describe, expect, it } from 'vitest'

import { parseSource } from 'src/editing/source-tree'

import { applyNodeWidths, nodeWidth, nodeWidthKeyForText, tagNodeWidthKeys, NODE_WIDTH_KEY } from './node-widths'

function group(payload?: Record<string, unknown>): { group: SVGGElement; label: HTMLElement } {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('class', 'markmap-node')
  ;(g as unknown as { __data__: unknown }).__data__ = { payload }

  const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  foreign.setAttribute('class', 'markmap-foreign')
  const outer = document.createElement('div')
  const label = document.createElement('div')
  outer.append(label)
  foreign.append(outer)
  g.append(foreign)
  return { group: g, label }
}

function svg(...groups: SVGGElement[]): SVGSVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  element.setAttribute('class', 'markmap')
  groups.forEach(g => element.append(g))
  return element
}

describe('nodeWidthKeyForText', () => {
  it('ignores formatting and comments so params do not change the key', () => {
    expect(nodeWidthKeyForText('  a   node ')).toBe(nodeWidthKeyForText('a node'))
    expect(nodeWidthKeyForText('a node <!-- width: 240 -->')).toBe(nodeWidthKeyForText('a node'))
    expect(nodeWidthKeyForText('a node <!-- bgColor: red -->')).toBe(nodeWidthKeyForText('a node'))
  })

  it('separates nodes with the same text', () => {
    expect(nodeWidthKeyForText('a', 1)).not.toBe(nodeWidthKeyForText('a'))
  })

  it('differentiates different texts', () => {
    expect(nodeWidthKeyForText('a')).not.toBe(nodeWidthKeyForText('b'))
  })
})

describe('tagNodeWidthKeys', () => {
  function pure(content: string, path: number[], children: IPureNode[] = []): IPureNode {
    return { content, children, payload: { advmmSourcePath: path } }
  }

  function keyOf(node: IPureNode): unknown {
    return node.payload?.[NODE_WIDTH_KEY]
  }

  it('gives every rendered node the key of its source line', () => {
    const roots = parseSource('- a\n- b\n')
    const a = pure('a', [0])
    const b = pure('b', [1])
    const root = pure('', [], [a, b])

    tagNodeWidthKeys(root, roots)

    expect(keyOf(a)).toBe(nodeWidthKeyForText('a'))
    expect(keyOf(b)).toBe(nodeWidthKeyForText('b'))
  })

  it('numbers duplicate texts in document order', () => {
    const roots = parseSource('- a\n- a\n  - a\n')
    const first = pure('a', [0])
    const second = pure('a', [1])
    const nested = pure('a', [1, 0])
    second.children.push(nested)
    const root = pure('', [], [first, second])

    tagNodeWidthKeys(root, roots)

    expect(keyOf(first)).toBe(nodeWidthKeyForText('a'))
    expect(keyOf(second)).toBe(nodeWidthKeyForText('a', 1))
    expect(keyOf(nested)).toBe(nodeWidthKeyForText('a', 2))
  })

  it('leaves render-only nodes without a key', () => {
    const roots = parseSource('- a\n')
    const title = pure('note', [])
    const a = pure('a', [0])
    title.children.push(a)

    tagNodeWidthKeys(title, roots)

    expect(keyOf(title)).toBeUndefined()
    expect(keyOf(a)).toBe(nodeWidthKeyForText('a'))
  })
})

describe('nodeWidth', () => {
  it('looks the width up by the node key', () => {
    const width = nodeWidthKeyForText('a')
    expect(nodeWidth(group({ [NODE_WIDTH_KEY]: width }).group, { [width]: 240 })).toBe(240)
  })

  it('ignores missing, invalid or unstored widths', () => {
    const width = nodeWidthKeyForText('a')
    expect(nodeWidth(group().group, { [width]: 240 })).toBeUndefined()
    expect(nodeWidth(group({ [NODE_WIDTH_KEY]: width }).group, {})).toBeUndefined()
    expect(nodeWidth(group({ [NODE_WIDTH_KEY]: width }).group, { [width]: 0 })).toBeUndefined()
    expect(nodeWidth(group({ [NODE_WIDTH_KEY]: width }).group, { [width]: '240' as never })).toBeUndefined()
  })
})

describe('applyNodeWidths', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('fixes the label width of nodes with a stored width', () => {
    const width = nodeWidthKeyForText('a')
    const a = group({ [NODE_WIDTH_KEY]: width })
    expect(applyNodeWidths(svg(a.group), { [width]: 240 })).toBe(true)
    expect(a.label.style.width).toBe('240px')
  })

  it('reports no change when the width is already applied', () => {
    const width = nodeWidthKeyForText('a')
    const a = group({ [NODE_WIDTH_KEY]: width })
    const element = svg(a.group)
    applyNodeWidths(element, { [width]: 240 })
    expect(applyNodeWidths(element, { [width]: 240 })).toBe(false)
  })

  it('removes the inline width from nodes without a stored width', () => {
    const a = group()
    a.label.style.width = '500px'
    expect(applyNodeWidths(svg(a.group), {})).toBe(true)
    expect(a.label.style.width).toBe('')
    expect(applyNodeWidths(svg(a.group), {})).toBe(false)
  })

  it('ignores groups without a node label', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('class', 'markmap-node')
    expect(() => applyNodeWidths(svg(g), {})).not.toThrow()
  })
})
