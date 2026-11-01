// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import type { FoldNode } from './fold'

// Obsidian augments the DOM with these helpers; provide a minimal version.
const proto = Element.prototype as any
proto.addClass = function (...classes: string[]) { this.classList.add(...classes) }
proto.removeClass = function (...classes: string[]) { this.classList.remove(...classes) }
proto.toggleClass = function (cls: string, on: boolean) { this.classList.toggle(cls, on) }
proto.createEl = function (tag: string, opts?: string | { cls?: string; text?: string }) {
  const el = document.createElement(tag)
  if (typeof opts === 'string') el.className = opts
  else {
    if (opts?.cls) el.className = opts.cls
    if (opts?.text) el.textContent = opts.text
  }
  this.append(el)
  return el
}
proto.createDiv = function (opts?: string | { cls?: string; text?: string }) {
  return this.createEl('div', opts)
}

function groupFor(svg: SVGSVGElement, data: unknown): SVGGElement {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = data
  svg.append(group)
  return group
}

function linkFor(svg: SVGSVGElement, source: unknown, target: unknown): SVGPathElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('class', 'markmap-link')
  ;(path as unknown as { __data__: unknown }).__data__ = { source, target }
  svg.append(path)
  return path
}

/** Synthetic root (`[]`) -> a (`[0]`) -> a1 (`[0,0]`) -> a1x (`[0,0,0]`). */
function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const a1xData = { content: 'a1x', children: [], payload: { advmmSourcePath: [0, 0, 0] } }
  const a1Data = { content: 'a1', children: [a1xData], payload: { advmmSourcePath: [0, 0] } }
  const aData = { content: 'a', children: [a1Data], payload: { advmmSourcePath: [0] } }
  const bData = { content: 'b', children: [], payload: { advmmSourcePath: [1] } }
  const rootData = { content: '', children: [aData, bData], payload: { advmmSourcePath: [] } }

  const rootGroup = groupFor(svg, rootData)
  const aGroup = groupFor(svg, aData)
  const a1Group = groupFor(svg, a1Data)
  const a1xGroup = groupFor(svg, a1xData)
  const bGroup = groupFor(svg, bData)

  // Connectors are separate `<path class="markmap-link">` elements whose bound
  // datum is `{ source, target }`.
  const rootLink = linkFor(svg, rootData, aData)
  const aLink = linkFor(svg, aData, a1Data)
  const a1xLink = linkFor(svg, a1Data, a1xData)
  const bLink = linkFor(svg, rootData, bData)

  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n  - a1\n    - a1x\n- b\n',
    setMarkdown: vi.fn(),
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }

  return { press, container, rootGroup, aGroup, a1Group, a1xGroup, bGroup, rootLink, aLink, a1Link: a1xLink, bLink }
}

describe('focus mode', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('highlights the cursor node and its direct children, dims the rest', () => {
    const { press, container, rootGroup, aGroup, a1Group, a1xGroup } = setup()
    press('ArrowDown')            // select `a`
    press('f')

    expect(container.classList.contains('advmm-focus-mode')).toBe(true)
    expect(aGroup.classList.contains('advmm-focus')).toBe(true)
    expect(a1Group.classList.contains('advmm-focus')).toBe(true)
    expect(a1xGroup.classList.contains('advmm-focus')).toBe(false)
    expect(rootGroup.classList.contains('advmm-focus')).toBe(false)
  })

  it('highlights all siblings with uppercase F, but not their children', () => {
    const { press, container, aGroup, a1Group, a1xGroup, bGroup } = setup()
    press('ArrowDown')
    press('F')

    expect(container.classList.contains('advmm-focus-mode')).toBe(true)
    expect(aGroup.classList.contains('advmm-focus')).toBe(true)
    expect(bGroup.classList.contains('advmm-focus')).toBe(true)
    expect(a1Group.classList.contains('advmm-focus')).toBe(false)
    expect(a1xGroup.classList.contains('advmm-focus')).toBe(false)
  })
  it('keeps the links into the focused nodes bright', () => {
    const { press, rootLink, aLink, a1Link } = setup()
    press('ArrowDown')            // select `a`
    press('f')

    // root -> a (into the cursor) and a -> a1 (into a direct child) stay bright;
    // a1 -> a1x (into a grandchild) is dimmed with the rest.
    expect(rootLink.classList.contains('advmm-focus-link')).toBe(true)
    expect(aLink.classList.contains('advmm-focus-link')).toBe(true)
    expect(a1Link.classList.contains('advmm-focus-link')).toBe(false)
  })


  it('toggles back off with a second press', () => {
    const { press, container, aGroup, a1Group } = setup()
    press('ArrowDown')
    press('f')
    press('f')

    expect(container.classList.contains('advmm-focus-mode')).toBe(false)
    expect(aGroup.classList.contains('advmm-focus')).toBe(false)
    expect(a1Group.classList.contains('advmm-focus')).toBe(false)
  })

  it('focuses the synthetic root and its top-level children', () => {
    const { press, rootGroup, aGroup, a1Group } = setup()
    press('ArrowDown')
    press('h')                    // root
    press('f')

    expect(rootGroup.classList.contains('advmm-focus')).toBe(true)
    expect(aGroup.classList.contains('advmm-focus')).toBe(true)
    expect(a1Group.classList.contains('advmm-focus')).toBe(false)
  })

  it('does not dim the tree while there is no selection', () => {
    const { press, container } = setup()
    press('f')

    expect(container.classList.contains('advmm-focus-mode')).toBe(false)
  })
})
