// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NODE_WIDTH_KEY } from 'src/rendering/node-widths'
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

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

/** jsdom has no layout: pretend every character is 10px wide in the mirror. */
function stubTextMetrics() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('advmm-node-measure'))
      return rect(0, 0, ((this as HTMLElement).textContent ?? '').length * 10, 20)
    return rect(0, 0, 0, 0)
  })
}

/**
 * A mindmap whose canvas is 500px wide with one node starting at x=10. Without
 * the canvas cap the editor would grow into a single line that leaves the pane
 * as soon as the text is longer than ~47 characters.
 */
function setup(scale = 1) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  container.getBoundingClientRect = () => rect(0, 0, 500, 800)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content: 'leaf',
    children: [],
    payload: { advmmSourcePath: [0], [NODE_WIDTH_KEY]: 'node-key' },
  }
  if (scale !== 1) {
    ;(group as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () =>
      ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }) as DOMMatrix
  }

  const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  foreignObject.setAttribute('class', 'markmap-foreign')
  const outer = document.createElement('div')
  const content = document.createElement('div')
  content.textContent = 'leaf'
  content.getBoundingClientRect = () => rect(10, 20, 100, 20)
  outer.append(content)
  foreignObject.append(outer)
  group.append(foreignObject)
  svg.append(group)

  const setNodeWidth = vi.fn((_key: string, _width: number | null) => true)
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- leaf\n',
    setMarkdown: () => {},
    getNodeWidths: () => ({}),
    setNodeWidth,
    getFoldRoot: () => ({ children: [] }),
    applyFoldPlan: () => {},
  })

  const press = (key: string) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }
  const editor = () => document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement | null

  /** Opens the editor on the node and types `text` into it. */
  const type = (text: string) => {
    press('ArrowDown')
    press('i')
    const input = editor()!
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input
  }

  const commitTyped = async (text: string) => {
    const input = type(text)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return { press, editor, type, commitTyped, setNodeWidth }
}

beforeEach(() => stubTextMetrics())

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('editing a node whose text does not fit the canvas', () => {
  it('wraps the editor at the visible width instead of running off screen', () => {
    const { type } = setup()

    const input = type('x'.repeat(100))

    // 500px of canvas, 24px kept free at the right, node starts at x=10.
    expect(input.style.width).toBe('466px')
  })

  it('stores the wrap width so the committed node wraps at the same place', async () => {
    const { commitTyped, setNodeWidth } = setup()

    await commitTyped('x'.repeat(100))

    expect(setNodeWidth).toHaveBeenCalledWith('node-key', 466)
  })

  it('stores content pixels, not screen pixels, when the map is zoomed', async () => {
    const { commitTyped, setNodeWidth } = setup(2)

    await commitTyped('x'.repeat(100))

    // 466 screen px at 2x is 233 px in the node's own coordinates.
    expect(setNodeWidth).toHaveBeenCalledWith('node-key', 233)
  })

  it('leaves a short text alone', async () => {
    const { commitTyped, setNodeWidth } = setup()

    await commitTyped('a slightly longer leaf')

    expect(setNodeWidth).not.toHaveBeenCalled()
  })

  it('does not reshape the node when the text did not change', async () => {
    const { press, editor, setNodeWidth } = setup()

    press('ArrowDown')
    press('i')
    editor()!.dispatchEvent(new FocusEvent('blur'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(setNodeWidth).not.toHaveBeenCalled()
  })
})
