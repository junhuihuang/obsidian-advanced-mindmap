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

function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const aData = { content: 'a', children: [], payload: { advmmSourcePath: [0] } }
  const bData = { content: 'b', children: [], payload: { advmmSourcePath: [1] } }
  const rootData = { content: '', children: [aData, bData], payload: { advmmSourcePath: [] } }

  groupFor(svg, rootData)
  const a = groupFor(svg, aData)
  const b = groupFor(svg, bData)

  const setMarkdown = vi.fn(() => Promise.resolve())
  const onSourceChange = vi.fn()
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n- b\n',
    setMarkdown,
    onSourceChange,
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  return { a, b, svg, rootData, setMarkdown, onSourceChange }
}

function drag(from: SVGGElement, to: SVGGElement) {
  from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }))
  ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => to
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }))
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 100 }))
}

function boxRect(left: number, right: number, top: number, bottom: number): DOMRect {
  return { left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

describe('mouse drag to move a node as a child', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('moves the dragged node under the target', async () => {
    const { a, b, setMarkdown } = setup()
    drag(a, b)
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- b\n  - a\n')
  })

  it('reports the drag as remove + insert edits for incremental rendering', async () => {
    const { a, b, onSourceChange } = setup()
    drag(a, b)
    await Promise.resolve()
    expect(onSourceChange).toHaveBeenCalledWith(
      '- a\n- b\n',
      '- b\n  - a\n',
      [{ type: 'remove', path: [0] }, { type: 'insert', path: [0, 0] }],
    )
  })

  it('does not move when the pointer never leaves the source', async () => {
    const { a, b, setMarkdown } = setup()
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }))
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => b
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 1, clientY: 1 }))
    await Promise.resolve()
    expect(setMarkdown).not.toHaveBeenCalled()
  })
})

describe('mouse drag to reorder among siblings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function dragTo(from: SVGGElement, to: SVGGElement, y: number) {
    from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }))
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => to
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: y }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 50, clientY: y }))
  }

  it('inserts before a sibling when dropped near its top edge', async () => {
    const { a, b, setMarkdown } = setup()
    a.getBoundingClientRect = () => boxRect(0, 100, 0, 20)
    dragTo(b, a, 2) // top third of `a`
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- b\n- a\n')
  })

  it('inserts after a sibling when dropped near its bottom edge', async () => {
    const { a, b, setMarkdown } = setup()
    b.getBoundingClientRect = () => boxRect(0, 100, 0, 20)
    dragTo(a, b, 18) // bottom third of `b`
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- b\n- a\n')
  })
})

describe('dropping a heading onto a list item', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('converts the heading to a list item and nests it', async () => {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const markdown = '## H\n# T\n- target\n'
    const hData = { content: 'H', children: [], payload: { advmmSourcePath: [0], tag: 'h2' } }
    const targetData = { content: 'target', children: [], payload: { advmmSourcePath: [1, 0], tag: 'li' } }
    const tData = { content: 'T', children: [targetData], payload: { advmmSourcePath: [1], tag: 'h1' } }
    const rootData = { content: '', children: [hData, tData], payload: { advmmSourcePath: [] } }

    groupFor(svg, rootData)
    const h = groupFor(svg, hData)
    groupFor(svg, tData)
    const target = groupFor(svg, targetData)

    const setMarkdown = vi.fn((_markdown: string) => Promise.resolve())
    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => markdown,
      setMarkdown,
      getFoldRoot: () => rootData as unknown as FoldNode,
    })

    drag(h, target)
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('# T\n- target\n  - H\n')
  })
})

describe('dropping onto a code block or table', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function setup() {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const markdown = '- a\n## H\n| x |\n|---|\n| 1 |\n'
    const aData = { content: 'a', children: [], payload: { advmmSourcePath: [0] } }
    const tableData = { content: '<table>…</table>', children: [], payload: { advmmSourcePath: [1, 0], tag: 'table' } }
    const hData = { content: 'H', children: [tableData], payload: { advmmSourcePath: [1], tag: 'h2' } }
    const rootData = { content: '', children: [aData, hData], payload: { advmmSourcePath: [] } }

    groupFor(svg, rootData)
    const a = groupFor(svg, aData)
    groupFor(svg, hData)
    const table = groupFor(svg, tableData)

    const setMarkdown = vi.fn((_markdown: string) => Promise.resolve())
    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => markdown,
      setMarkdown,
      getFoldRoot: () => rootData as unknown as FoldNode,
    })

    return { a, table, setMarkdown }
  }

  it('nests under the block\'s parent instead of the block itself', async () => {
    const { a, table, setMarkdown } = setup()
    drag(a, table)
    await Promise.resolve()
    // The table cannot own children, so the node joins the enclosing heading.
    expect(setMarkdown).toHaveBeenCalledWith('## H\n| x |\n|---|\n| 1 |\n- a\n')
  })
})

describe('mouse drag shows the parent connector line', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('draws a curved rubber-band line while dragging and clears it on drop', async () => {
    const { a, b, svg, rootData, setMarkdown } = setup()
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    link.setAttribute('class', 'markmap-link')
    ;(link as unknown as { __data__: unknown }).__data__ = { source: rootData, target: (a as unknown as { __data__: unknown }).__data__ }
    // jsdom does not implement getPointAtLength; provide a stub.
    ;(link as any).getPointAtLength = (_len: number) => ({ x: 50, y: 30 })
    // Give the link some stroke attributes so getComputedStyle picks them up.
    link.style.stroke = '#123456'
    link.style.strokeWidth = '1.5'
    // The new rubber-band path is appended to the link's parent, so the link
    // must already be inside the zoom group.
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.appendChild(link)
    svg.appendChild(g)

    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }))
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => b
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }))
    expect(document.querySelector('path.markmap-link.advmm-drag-link')).not.toBeNull()

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 100 }))
    expect(document.querySelector('path.markmap-link.advmm-drag-link')).toBeNull()

    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- b\n  - a\n')
  })

  it('updates the bezier curve as the pointer moves', () => {
    const { a, b, svg, rootData } = setup()
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    link.setAttribute('class', 'markmap-link')
    ;(link as unknown as { __data__: unknown }).__data__ = { source: rootData, target: (a as unknown as { __data__: unknown }).__data__ }
    ;(link as any).getPointAtLength = (_len: number) => ({ x: 50, y: 30 })
    link.style.stroke = '#123456'
    link.style.strokeWidth = '1.5'
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.appendChild(link)
    svg.appendChild(g)

    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }))
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => b
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 40 }))
    const band = document.querySelector<SVGPathElement>('path.markmap-link.advmm-drag-link')
    expect(band).not.toBeNull()
    const first = band!.getAttribute('d')

    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 90, clientY: 120 }))
    expect(band!.getAttribute('d')).not.toBe(first)
  })
})
