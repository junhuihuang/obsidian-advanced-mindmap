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

function nodeGroup(svg: SVGSVGElement, content: string, path: number[], lines: string) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content,
    children: [],
    payload: { advmmSourcePath: path, lines },
  }
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  fo.setAttribute('class', 'markmap-foreign')
  const outer = document.createElement('div')
  const inner = document.createElement('div')
  inner.textContent = content
  outer.append(inner)
  fo.append(outer)
  group.append(fo)
  svg.append(group)
  return group
}

/**
 * Flushes microtasks, but never `requestAnimationFrame`: markmap's second
 * `renderData` (triggered by its ResizeObserver after it measures a new node)
 * rewrites every node's `class`, so the selection highlight must come back in
 * the same microtask turn — not one frame later, which flickers.
 */
const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('selection highlight is restored after markmap rewrites node classes', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('re-applies .advmm-selected within the same microtask turn (no rAF)', async () => {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    nodeGroup(svg, 'a', [0], '0,1')

    const handle = attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => '- a\n',
      setMarkdown: vi.fn(() => new Promise<void>(() => {})),
      getFoldRoot: () => ({ children: [] }),
      applyFoldPlan: () => {},
    })

    // Select `a`, then add a sibling: the editor selects the not-yet-rendered
    // `[1]` and opens the inline input immediately.
    const a = Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
      .find(group => group.textContent === 'a')!
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushMicrotasks()

    // Simulate markmap's incremental render landing: insert the new node and,
    // exactly like `renderData` does, rewrite every node's `class`.
    const newGroup = nodeGroup(svg, 'New node', [1], '1,2')
    for (const group of Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))) {
      group.setAttribute('class', 'markmap-node')
    }

    // No rAF: the MutationObserver must have restored the highlight in a
    // microtask. rAF is deliberately not awaited to prove it is not needed.
    await flushMicrotasks()
    expect(newGroup.classList.contains('advmm-selected')).toBe(true)
    expect(a.classList.contains('advmm-selected')).toBe(false)

    // markmap's ResizeObserver fires a *second* render ~100ms later and
    // rewrites every class again; the highlight must survive that too.
    for (const group of Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))) {
      group.setAttribute('class', 'markmap-node')
    }
    await flushMicrotasks()
    expect(newGroup.classList.contains('advmm-selected')).toBe(true)
    expect(a.classList.contains('advmm-selected')).toBe(false)

    handle.destroy()
  })
})
