// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import type { FoldNode } from './fold'
import { Transformer } from 'markmap-lib'
import { parseSource } from './source-tree'
import { getSourcePath, tagSourcePaths } from './source-paths'

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

/** Three top-level siblings `- a` / `- b` / `- c`. */
function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const nodes = [
    { content: 'a', children: [], payload: { advmmSourcePath: [0] } },
    { content: 'b', children: [], payload: { advmmSourcePath: [1] } },
    { content: 'c', children: [], payload: { advmmSourcePath: [2] } },
  ]
  const rootData = { content: '', children: nodes, payload: { advmmSourcePath: [] } }
  groupFor(svg, rootData)
  const groups = nodes.map(node => groupFor(svg, node))

  const setMarkdown = vi.fn((_markdown: string) => Promise.resolve())
  const onSourceChange = vi.fn()
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n- b\n- c\n',
    setMarkdown,
    onSourceChange,
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  const select = (index: number) => {
    groups[index].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  const press = (key: string) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }

  return { groups, select, press, setMarkdown, onSourceChange }
}

describe('keyboard reorder (vim J / K)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('J moves the selected node down one sibling', async () => {
    const { select, press, setMarkdown } = setup()
    select(1)
    press('J')
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- a\n- c\n- b\n')
  })

  it('reports the move as remove + insert edits for incremental rendering', async () => {
    const { select, press, onSourceChange } = setup()
    select(1)  // `b`
    press('J') // down: a, c, b
    await Promise.resolve()
    expect(onSourceChange).toHaveBeenCalledWith(
      '- a\n- b\n- c\n',
      '- a\n- c\n- b\n',
      [{ type: 'remove', path: [1] }, { type: 'insert', path: [2] }],
    )
  })

  it('K moves the selected node up one sibling', async () => {
    const { select, press, setMarkdown } = setup()
    select(1)
    press('K')
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- b\n- a\n- c\n')
  })

  it.each(['J', 'K'])('keeps selection and keyboard focus on the moved node after %s', async key => {
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)
    let markdown = '- a\n- b\n- c\n'
    const transformer = new Transformer()
    const render = () => {
      const { root } = transformer.transform(markdown)
      tagSourcePaths(root, parseSource(markdown))
      svg.replaceChildren()
      // A synthetic root and the first list item share source line 0.
      // Render the root first, as it can appear in markmap's DOM.
      const visit = (node: typeof root) => {
        groupFor(svg, node)
        node.children.forEach(visit)
      }
      visit(root)
    }
    render()
    const handle = attachNodeEditor({
      svg,
      getMarkdown: () => markdown,
      setMarkdown: async next => { markdown = next; render() },
    })
    const press = (value: string) => container.dispatchEvent(new KeyboardEvent('keydown', {
      key: value, bubbles: true, cancelable: true,
    }))
    const selected = () => Array.from(svg.querySelectorAll<SVGGElement>('g.advmm-selected'))
      .map(group => (group as any).__data__.content)
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
    try {
      const b = Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
        .find(group => (group as any).__data__.content === 'b')!
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      press(key)
      await settle()
      expect(markdown).toBe(key === 'J' ? '- a\n- c\n- b\n' : '- b\n- a\n- c\n')
      expect(selected()).toEqual(['b'])
      expect(document.activeElement).toBe(container)
      const moved = svg.querySelector<SVGGElement>('g.advmm-selected')!
      expect(getSourcePath((moved as any).__data__)).toEqual(key === 'J' ? [2] : [0])

      // No intervening click: reverse the move using the retained cursor.
      press(key === 'J' ? 'K' : 'J')
      await settle()
      expect(markdown).toBe('- a\n- b\n- c\n')
      expect(selected()).toEqual(['b'])
      expect(document.activeElement).toBe(container)
    } finally {
      handle.destroy()
    }
  })

  it('does nothing at the top with K', async () => {
    const { select, press, setMarkdown } = setup()
    select(0)
    press('K')
    await Promise.resolve()
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('does nothing at the bottom with J', async () => {
    const { select, press, setMarkdown } = setup()
    select(2)
    press('J')
    await Promise.resolve()
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('does nothing when nothing is selected', async () => {
    const { press, setMarkdown } = setup()
    press('J')
    press('K')
    await Promise.resolve()
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('reorders nested siblings under the same parent', async () => {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const markdown = '- a\n  - a1\n  - a2\n- b\n'
    const nodes = [
      { content: 'a', children: [], payload: { advmmSourcePath: [0] } },
      { content: 'a1', children: [], payload: { advmmSourcePath: [0, 0] } },
      { content: 'a2', children: [], payload: { advmmSourcePath: [0, 1] } },
      { content: 'b', children: [], payload: { advmmSourcePath: [1] } },
    ]
    const rootData = { content: '', children: nodes, payload: { advmmSourcePath: [] } }
    groupFor(svg, rootData)
    const groups = nodes.map(node => groupFor(svg, node))

    const setMarkdown = vi.fn((_markdown: string) => Promise.resolve())
    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => markdown,
      setMarkdown,
      getFoldRoot: () => rootData as unknown as FoldNode,
    })

    groups[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(setMarkdown).toHaveBeenCalledWith('- a\n  - a2\n  - a1\n- b\n')
  })
})
