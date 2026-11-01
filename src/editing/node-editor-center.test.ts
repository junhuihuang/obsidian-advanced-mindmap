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

/** A synthetic empty root (`[]`) with one top-level child (`[0]`). */
function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  const childData = { content: 'a', children: [], payload: { advmmSourcePath: [0] } }
  const rootData = { content: '', children: [childData], payload: { advmmSourcePath: [] } }

  groupFor(svg, rootData)
  groupFor(svg, childData)

  const centerNode = vi.fn()
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n',
    setMarkdown: () => {},
    centerNode,
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }
  const pressInInput = (key: string, init: KeyboardEventInit = {}) => {
    const input = document.querySelector('textarea.advmm-node-editor')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }

  return { press, pressInInput, centerNode, rootData, childData }
}

describe('centering the selected node with Shift+M', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('centers the selected node', () => {
    const { press, centerNode, childData } = setup()
    press('ArrowDown')                 // select the top-level child
    press('M', { shiftKey: true })
    expect(centerNode).toHaveBeenCalledTimes(1)
    expect(centerNode).toHaveBeenCalledWith(childData)
  })

  it('centers whatever node is currently selected', () => {
    const { press, centerNode, rootData } = setup()
    press('ArrowDown')
    press('h')                         // move the cursor up to the root
    press('M', { shiftKey: true })
    expect(centerNode).toHaveBeenCalledWith(rootData)
  })

  it('does nothing without a selection', () => {
    const { press, centerNode } = setup()
    press('M', { shiftKey: true })
    expect(centerNode).not.toHaveBeenCalled()
  })

  it('does not center with a plain m', () => {
    const { press, centerNode } = setup()
    press('ArrowDown')
    press('m')
    expect(centerNode).not.toHaveBeenCalled()
  })

  it('does not center while editing a node', () => {
    const { press, pressInInput, centerNode } = setup()
    press('ArrowDown')
    press('i')                         // opens the inline editor
    pressInInput('M', { shiftKey: true })
    expect(centerNode).not.toHaveBeenCalled()
  })
})
