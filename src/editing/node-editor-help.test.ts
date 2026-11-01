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

  const childData = { content: 'a', children: [], payload: { advmmSourcePath: [0] } }
  const rootData = { content: '', children: [childData], payload: { advmmSourcePath: [] } }

  groupFor(svg, rootData)
  const childGroup = groupFor(svg, childData)

  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n',
    setMarkdown: vi.fn(),
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }

  return { press, container, childGroup }
}

function overlay(): HTMLElement | null {
  return document.querySelector('.advmm-help-overlay')
}

describe('the ? keyboard-shortcut overlay', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('opens on ?', () => {
    const { press } = setup()
    press('?')
    expect(overlay()).not.toBeNull()
    expect(overlay()!.classList.contains('advmm-hidden')).toBe(false)
    expect(overlay()!.querySelector('kbd')?.textContent?.length).toBeGreaterThan(0)
  })

  it('closes again on a second ?', () => {
    const { press } = setup()
    press('?')
    press('?')
    expect(overlay()!.classList.contains('advmm-hidden')).toBe(true)
  })

  it('closes on Escape without clearing the selection', () => {
    const { press, childGroup } = setup()
    press('ArrowDown')          // select the child
    press('?')
    press('Escape')
    expect(overlay()!.classList.contains('advmm-hidden')).toBe(true)
    expect(childGroup.classList.contains('advmm-selected')).toBe(true)
  })

  it('is not opened while typing in a text field', () => {
    const { container } = setup()
    const input = document.createElement('input')
    container.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }))
    expect(overlay()).toBeNull()
  })
})
