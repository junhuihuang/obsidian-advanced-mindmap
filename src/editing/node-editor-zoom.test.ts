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

let editor: { destroy: () => void } | null = null

/** A synthetic empty root (`[]`) with one top-level child (`[0]`). */
function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const childData = { content: 'a', children: [], payload: { advmmSourcePath: [0] } }
  const rootData = { content: '', children: [childData], payload: { advmmSourcePath: [] } }

  const rootGroup = groupFor(svg, rootData)
  const childGroup = groupFor(svg, childData)

  const anchor = { x: 10, y: 20 }
  const contentAnchor = { x: 100, y: 200 }
  const rect = { x: 0, y: 0, width: 30, height: 12 }
  const zoomBy = vi.fn()
  const getZoomAnchor = vi.fn(() => anchor)
  const getZoomRect = vi.fn(() => rect)
  const getContentZoomAnchor = vi.fn(() => contentAnchor)
  const handle = attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n',
    setMarkdown: () => {},
    getFoldRoot: () => rootData as unknown as FoldNode,
    zoomBy,
    getZoomAnchor,
    getZoomRect,
    getContentZoomAnchor,
  })
  editor = handle

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }
  const release = (key: string) => {
    container.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  }

  return { press, release, destroy: handle.destroy, rootGroup, childGroup, childData, rootData, anchor, contentAnchor, rect, zoomBy, getZoomAnchor, getZoomRect, getContentZoomAnchor }
}

const zoomKeys = { shiftKey: true }

describe('keyboard zoom', () => {
  afterEach(() => {
    editor?.destroy()
    editor = null
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('zooms in on Shift++ with nothing selected, about the content center', () => {
    const { press, zoomBy, getContentZoomAnchor, contentAnchor } = setup()
    press('+', zoomKeys)

    expect(zoomBy).toHaveBeenCalledTimes(1)
    const [factor, anchor] = zoomBy.mock.calls[0]
    expect(factor).toBeGreaterThan(1)
    // With no selection the whole content is centered on the canvas.
    expect(getContentZoomAnchor).toHaveBeenCalled()
    expect(anchor).toBe(contentAnchor)
  })

  it('zooms out on Shift+- (underscore)', () => {
    const { press, zoomBy } = setup()
    press('_', zoomKeys)

    expect(zoomBy).toHaveBeenCalledTimes(1)
    expect(zoomBy.mock.calls[0][0]).toBeCloseTo(1 / 1.2)
  })

  it('leaves Ctrl+Shift++ for resizing the selected node instead of zooming', () => {
    const { press, zoomBy } = setup()
    press('+', { ctrlKey: true, shiftKey: true })
    expect(zoomBy).not.toHaveBeenCalled()
  })

  it('zooms out on the numpad minus', () => {
    const { press, zoomBy } = setup()
    press('-', zoomKeys)
    expect(zoomBy).toHaveBeenCalledTimes(1)
    expect(zoomBy.mock.calls[0][0]).toBeLessThan(1)
  })

  it('centers the zoom on the selected node and keeps it on screen', () => {
    const { press, zoomBy, getZoomAnchor, getZoomRect, getContentZoomAnchor, childData, anchor, rect } = setup()
    press('ArrowDown')             // select the top-level child
    getZoomAnchor.mockClear()
    getZoomRect.mockClear()
    getContentZoomAnchor.mockClear()
    zoomBy.mockClear()
    press('+', zoomKeys)

    expect(getZoomAnchor).toHaveBeenCalledWith(childData)
    // The selected node wins; the content center is not consulted.
    expect(getContentZoomAnchor).not.toHaveBeenCalled()
    // The node's own box travels along so it can be clamped back on screen.
    expect(getZoomRect).toHaveBeenCalledWith(childData)
    expect(zoomBy).toHaveBeenCalledTimes(1)
    expect(zoomBy.mock.calls[0][0]).toBeGreaterThan(1)
    expect(zoomBy.mock.calls[0][1]).toBe(anchor)
    expect(zoomBy.mock.calls[0][2]).toBe(rect)
  })

  it('passes no visibility box when nothing is selected', () => {
    const { press, zoomBy, getZoomRect } = setup()
    press('+', zoomKeys)

    expect(getZoomRect).not.toHaveBeenCalled()
    expect(zoomBy.mock.calls[0][2]).toBeUndefined()
  })

  it('keeps passing the box on every held frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const { press, zoomBy, rect } = setup()
    press('ArrowDown')
    zoomBy.mockClear()
    press('+', zoomKeys)
    frames.shift()!(performance.now() + 100)

    expect(zoomBy).toHaveBeenCalledTimes(2)
    expect(zoomBy.mock.calls[1][2]).toBe(rect)
  })

  it('centers the zoom on the synthetic root when it is selected', () => {
    const { press, zoomBy, getZoomAnchor, rootData, childGroup } = setup()
    press('ArrowDown')
    press('h')                     // move up to the root
    getZoomAnchor.mockClear()
    press('_', zoomKeys)

    expect(getZoomAnchor).toHaveBeenCalledWith(rootData)
    expect(zoomBy.mock.calls[0][1]).toEqual({ x: 10, y: 20 })
    // Zooming must not disturb the selection.
    expect(childGroup.classList.contains('advmm-selected')).toBe(false)
  })

  it('does not select a node when zooming with nothing selected', () => {
    const { press, childGroup } = setup()
    press('+', zoomKeys)
    expect(childGroup.classList.contains('advmm-selected')).toBe(false)
  })

  it('requires Shift', () => {
    const { press, zoomBy } = setup()
    press('+', { ctrlKey: true })
    press('-', { ctrlKey: true })
    expect(zoomBy).not.toHaveBeenCalled()
  })

  it('ignores unrelated keys', () => {
    const { press, zoomBy } = setup()
    press('=', zoomKeys)
    press('0', zoomKeys)
    press('x', zoomKeys)
    expect(zoomBy).not.toHaveBeenCalled()
  })

  it('keeps zooming smoothly while the key is held', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const { press, release, zoomBy } = setup()
    press('+', zoomKeys)

    // A single press applies an immediate, visible step (a quick tap still zooms).
    expect(zoomBy).toHaveBeenCalledTimes(1)

    // The held key keeps zooming on every animation frame.
    const frame = frames.shift()!
    frame(performance.now() + 100)
    expect(zoomBy).toHaveBeenCalledTimes(2)
    expect(zoomBy.mock.calls[1][0]).toBeGreaterThan(1)

    // Releasing the key stops the loop.
    release('+')
    frames.shift()?.(performance.now() + 200)
    expect(zoomBy).toHaveBeenCalledTimes(2)
  })
})
