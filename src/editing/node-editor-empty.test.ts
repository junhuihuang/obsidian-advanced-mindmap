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

function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content: 'leaf',
    children: [],
    payload: { advmmSourcePath: [0] },
  }
  svg.append(group)

  const setMarkdown = vi.fn()
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- leaf\n',
    setMarkdown,
    getFoldRoot: () => ({ children: [] }),
    applyFoldPlan: () => {},
  })

  const press = (key: string) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }

  return { press, setMarkdown }
}

/** Opens the inline editor on the selected node, then types `value` + Enter. */
function edit(press: (key: string) => void, value: string) {
  press('ArrowDown')
  press('i')
  const input = document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement
  input.value = value
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

describe('empty nodes are not allowed', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('does not write when the node is cleared', () => {
    const { press, setMarkdown } = setup()
    edit(press, '')
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('does not write when the node is only whitespace', () => {
    const { press, setMarkdown } = setup()
    edit(press, '   ')
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('still writes a non-empty rename', () => {
    const { press, setMarkdown } = setup()
    edit(press, 'renamed')
    expect(setMarkdown).toHaveBeenCalledWith('- renamed\n')
  })
})
