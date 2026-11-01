// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function boxRect(left: number, right: number, top: number, bottom: number): DOMRect {
  return { left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

function groupFor(svg: SVGSVGElement, data: unknown): { group: SVGGElement; label: HTMLElement } {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = data

  const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  foreign.setAttribute('class', 'markmap-foreign')
  const outer = document.createElement('div')
  const label = document.createElement('div')
  outer.append(label)
  foreign.append(outer)
  group.append(foreign)
  svg.append(group)

  return { group, label }
}

function setup(markdown = '- a\n- b\n') {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const aData = { content: 'a', children: [], payload: { advmmSourcePath: [0], advmmWidthKey: 'a' } }
  const bData = { content: 'b', children: [], payload: { advmmSourcePath: [1], advmmWidthKey: 'b' } }
  const rootData = { content: '', children: [aData, bData], payload: { advmmSourcePath: [] } }

  groupFor(svg, rootData)
  const a = groupFor(svg, aData)
  const b = groupFor(svg, bData)
  a.label.getBoundingClientRect = () => boxRect(0, 100, 0, 20)
  b.label.getBoundingClientRect = () => boxRect(0, 120, 20, 40)

  const setMarkdown = vi.fn(() => Promise.resolve())
  const widths: Record<string, number> = {}
  const setNodeWidth = vi.fn((key: string, width: number | null) => {
    if (width === null) delete widths[key]
    else widths[key] = width
    return true
  })
  const onSourceChange = vi.fn()
  const beginLiveLayout = vi.fn()
  const endLiveLayout = vi.fn()
  const relayout = vi.fn(() => Promise.resolve())
  ;(document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => markdown,
    setMarkdown,
    getNodeWidths: () => widths,
    setNodeWidth,
    onSourceChange,
    beginLiveLayout,
    endLiveLayout,
    relayout,
  })

  a.group.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

  return { a, b, svg, container, setMarkdown, widths, setNodeWidth, onSourceChange, beginLiveLayout, endLiveLayout, relayout }
}

function press(group: SVGGElement, x: number, y: number) {
  group.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }))
}

function moveTo(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
}

function release(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }))
}

describe('resizing a node from its right edge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('stores the dragged width without touching the markdown', async () => {
    const { a, setMarkdown, setNodeWidth, widths } = setup()
    press(a.group, 100, 10)
    moveTo(130, 10)
    release(130, 10)
    await Promise.resolve()

    expect(setNodeWidth).toHaveBeenCalledWith('a', 130)
    expect(widths).toEqual({ a: 130 })
    expect(a.label.style.width).toBe('130px')
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('does not write a width comment into the node text', async () => {
    const { a, setMarkdown } = setup('- a <!-- bgColor: red -->\n- b\n')
    press(a.group, 100, 10)
    moveTo(150, 10)
    release(150, 10)
    await Promise.resolve()

    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('clamps the width to the supported minimum', async () => {
    const { a, setNodeWidth } = setup()
    press(a.group, 100, 10)
    moveTo(-100, 10)
    release(-100, 10)
    await Promise.resolve()

    expect(setNodeWidth).toHaveBeenCalledWith('a', 40)
  })

  it('updates the foreignObject box immediately so the text is never clipped', () => {
    const { a } = setup()
    Object.defineProperty(a.label, 'scrollWidth', { value: 130, configurable: true })
    Object.defineProperty(a.label, 'scrollHeight', { value: 40, configurable: true })
    press(a.group, 100, 10)
    moveTo(130, 10)

    const foreign = a.group.querySelector('foreignObject')!
    expect(foreign.getAttribute('width')).toBe('130')
    expect(foreign.getAttribute('height')).toBe('40')
  })

  it('turns off markmap transitions and relayouts while dragging', async () => {
    const { a, beginLiveLayout, endLiveLayout, relayout } = setup()
    press(a.group, 100, 10)
    moveTo(130, 10)

    expect(beginLiveLayout).toHaveBeenCalledTimes(1)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await Promise.resolve()
    await Promise.resolve()
    expect(relayout).toHaveBeenCalled()

    release(130, 10)
    expect(endLiveLayout).toHaveBeenCalledTimes(1)
  })

  it('does not resize a node that is not the selected one', async () => {
    const { a, b, onSourceChange, setNodeWidth } = setup()
    // Select `a`, then press the right edge of `b`.
    press(b.group, 120, 30)
    moveTo(150, 30)
    release(150, 30)
    await Promise.resolve()

    expect(onSourceChange).not.toHaveBeenCalled()
    expect(setNodeWidth).not.toHaveBeenCalled()
    expect(a.label.style.width).toBe('')
  })

  it('widens the selected node with Ctrl+Shift++ and stores the width on keyup', async () => {
    const { container, a, setMarkdown, setNodeWidth } = setup()
    const keydown = (key: string) => container.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    const keyup = (key: string) => container.dispatchEvent(new KeyboardEvent('keyup', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))

    keydown('+')
    keydown('+')
    expect(a.label.style.width).toBe('148px')
    expect(setMarkdown).not.toHaveBeenCalled()

    keyup('+')
    await Promise.resolve()
    expect(setNodeWidth).toHaveBeenCalledWith('a', 148)
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('narrows the selected node with Ctrl+Shift+-', async () => {
    const { container, a, setMarkdown, setNodeWidth } = setup()
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '_', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(a.label.style.width).toBe('76px')
    container.dispatchEvent(new KeyboardEvent('keyup', { key: '_', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(setNodeWidth).toHaveBeenCalledWith('a', 76)
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('does not resize with Ctrl+Shift+plus when nothing is selected', () => {
    const { container, a, setMarkdown, setNodeWidth } = setup()
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '+', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))

    expect(a.label.style.width).toBe('')
    expect(setMarkdown).not.toHaveBeenCalled()
    expect(setNodeWidth).not.toHaveBeenCalled()
  })

  it('does not resize when pressing away from the right edge', async () => {
    const { a, setMarkdown, setNodeWidth } = setup()
    press(a.group, 50, 10)
    moveTo(80, 10)
    release(80, 10)
    await Promise.resolve()

    expect(setMarkdown).not.toHaveBeenCalled()
    expect(setNodeWidth).not.toHaveBeenCalled()
  })
})
