// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import type { FoldNode } from './fold'

// Obsidian augments the DOM with these helpers; provide a minimal version.
const proto = Element.prototype as any
proto.addClass = function (...classes: string[]) { this.classList.add(...classes) }
proto.removeClass = function (...classes: string[]) { this.classList.remove(...classes) }
proto.toggleClass = function (cls: string, on: boolean) { this.classList.toggle(cls, on) }
proto.createEl = function (tag: string, opts?: string | { cls?: string, text?: string }) {
  const el = document.createElement(tag)
  if (typeof opts === 'string') el.className = opts
  else {
    if (opts?.cls) el.className = opts.cls
    if (opts?.text) el.textContent = opts.text
  }
  this.append(el)
  return el
}
proto.createDiv = function (opts?: string | { cls?: string, text?: string }) {
  return this.createEl('div', opts)
}

function groupFor(svg: SVGSVGElement, data: unknown): SVGGElement {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = data
  svg.append(group)
  return group
}

const MARKDOWN = '- root\n  - A\n    - a1\n  - B\n'

/**
 * `- root` → `A` → `a1`, and `B`, rendered the way this plugin does it: a
 * render-only title root (source path `[]`) above the document's own top-level
 * node `[0]`.
 */
function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const a1Data = { content: 'a1', children: [], payload: { advmmSourcePath: [0, 0, 0] } }
  const aData = { content: 'A', children: [a1Data], payload: { advmmSourcePath: [0, 0] } }
  const bData = { content: 'B', children: [], payload: { advmmSourcePath: [0, 1] } }
  const docRoot = { content: 'root', children: [aData, bData], payload: { advmmSourcePath: [0] } }
  const rootData = { content: 'note', children: [docRoot], payload: { advmmSourcePath: [] } }

  const root = groupFor(svg, rootData)
  const groups = {
    root,
    docRoot: groupFor(svg, docRoot),
    a: groupFor(svg, aData),
    a1: groupFor(svg, a1Data),
    b: groupFor(svg, bData),
  }

  const setMarkdown = vi.fn((_markdown: string) => Promise.resolve())
  const onSourceChange = vi.fn()
  attachNodeEditor({
    svg,
    getMarkdown: () => MARKDOWN,
    setMarkdown,
    onSourceChange,
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  const click = (group: SVGGElement, init: MouseEventInit = {}) =>
    group.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  const press = (key: string, init: KeyboardEventInit = {}) =>
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

  /** Ctrl+X on the current selection. */
  const cut = () => press('x', { ctrlKey: true })
  /** Ctrl+V on the current selection as the paste destination. */
  const paste = () => press('v', { ctrlKey: true })

  return { groups, click, press, cut, paste, setMarkdown, onSourceChange }
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('cut and paste onto the root', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('pastes onto the title root as a new top-level node', async () => {
    const { groups, click, cut, paste, setMarkdown } = setup()
    click(groups.a)
    cut()
    click(groups.root)
    paste()
    await settle()

    expect(setMarkdown).toHaveBeenCalledWith('- root\n  - B\n- A\n  - a1\n')
  })

  it('reports the paste as remove + insert for incremental rendering', async () => {
    const { groups, click, cut, paste, onSourceChange } = setup()
    click(groups.a)
    cut()
    click(groups.root)
    paste()
    await settle()

    expect(onSourceChange).toHaveBeenCalledWith(
      MARKDOWN,
      '- root\n  - B\n- A\n  - a1\n',
      [{ type: 'remove', path: [0, 0] }, { type: 'insert', path: [1] }],
    )
  })

  it('moves every marked node to the top level in one edit', async () => {
    const { groups, click, cut, paste, onSourceChange } = setup()
    click(groups.a)
    // Shift+click extends the selection, so A and B are both marked.
    click(groups.b, { shiftKey: true })
    cut()
    click(groups.root)
    paste()
    await settle()

    expect(onSourceChange).toHaveBeenCalledWith(
      MARKDOWN,
      '- root\n- A\n  - a1\n- B\n',
      [
        // Removals run back to front so the shifted paths stay valid.
        { type: 'remove', path: [0, 1] },
        { type: 'remove', path: [0, 0] },
        { type: 'insert', path: [1] },
        { type: 'insert', path: [2] },
      ],
    )
  })

  it('still pastes onto a regular node as its last child', async () => {
    const { groups, click, cut, paste, setMarkdown } = setup()
    click(groups.a)
    cut()
    click(groups.b)
    paste()
    await settle()

    expect(setMarkdown).toHaveBeenCalledWith('- root\n  - B\n    - A\n      - a1\n')
  })

  it('drops a dragged node onto the root as a top-level node', async () => {
    const { groups, setMarkdown } = setup()
    groups.a.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0,
    }))
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => groups.root
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 100 }))
    await settle()

    expect(setMarkdown).toHaveBeenCalledWith('- root\n  - B\n- A\n  - a1\n')
  })
})
