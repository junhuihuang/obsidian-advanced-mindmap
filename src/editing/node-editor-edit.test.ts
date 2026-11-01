// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { attachNodeEditor } from './node-editor'

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

function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  // One selectable node whose source path points at the `- leaf` line below.
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content: 'leaf',
    children: [],
    payload: { advmmSourcePath: [0] },
  }
  // markmap draws a node's visible box inside a foreignObject; the surrounding
  // <g> also contains the connector line and fold circle.
  const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  foreignObject.setAttribute('class', 'markmap-foreign')
  const outer = document.createElement('div')
  const content = document.createElement('div')
  content.textContent = 'leaf'
  outer.append(content)
  foreignObject.append(outer)
  group.append(foreignObject)
  svg.append(group)

  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- leaf\n',
    setMarkdown: () => {},
    getFoldRoot: () => ({ children: [] }),
    applyFoldPlan: () => {},
  })

  const press = (key: string) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }

  return { press, group, content }
}

describe('i to edit', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('opens the inline editor with the caret at the end', () => {
    const { press } = setup()
    press('ArrowDown')
    press('i')

    const input = document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement | null
    expect(input).not.toBeNull()
    expect(input!.value).toBe('leaf')
    expect(input!.selectionStart).toBe(4)
    expect(input!.selectionEnd).toBe(4)
  })

  it('does nothing without a selection', () => {
    const { press } = setup()
    press('i')
    expect(document.querySelector('textarea.advmm-node-editor')).toBeNull()
  })

  it('aligns the editor with the visible node box, not the group bounding box', () => {
    const { press, group, content } = setup()
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect
    // The group bbox is offset by the connector line (left of the text) and
    // includes the fold circle (right of it). Only the content box is correct.
    group.getBoundingClientRect = () => rect(1, 2, 300, 400)
    content.getBoundingClientRect = () => rect(11, 22, 200, 44)
    // The node is zoomed 2x and draws 20px text, so on screen it reads as 40px.
    content.style.fontSize = '20px'
    content.style.lineHeight = '20px'
    ;(group as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () =>
      ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }) as DOMMatrix

    press('ArrowDown')
    press('i')

    const input = document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement | null
    expect(input).not.toBeNull()
    expect(input!.style.left).toBe('11px')
    expect(input!.style.top).toBe('22px')
    // Editor starts at the node's rendered width (200px) when the rect is
    // trusted (existing node), then tracks text after the user types.
    expect(input!.style.width).toBe('200px')
    // Height is always content-based (lineHeight floor, not rect.height).
    expect(input!.style.height).toBe('40px')
    expect(input!.style.fontSize).toBe('40px')
  })

  // markmap wraps a long node's text at `maxWidth`, so the editor must be able to
  // wrap too, with the node's own font metrics (size *and* line height, family
  // and weight) and without any border or padding eating into the text width.
  it('edits in a textarea carrying the node font metrics', () => {
    const { press, group, content } = setup()
    content.style.fontSize = '20px'
    content.style.lineHeight = '30px'
    content.style.fontFamily = 'Inter'
    content.style.fontWeight = '300'
    ;(group as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () =>
      ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }) as DOMMatrix

    press('ArrowDown')
    press('i')

    const input = document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement | null
    expect(input).not.toBeNull()
    expect(input!.style.fontSize).toBe('40px')
    expect(input!.style.lineHeight).toBe('60px')
    expect(input!.style.fontFamily).toBe('Inter')
    expect(input!.style.fontWeight).toBe('300')
    expect(input!.style.padding).toBe('0px')
    expect(input!.style.borderStyle).toBe('none')
  })
})
