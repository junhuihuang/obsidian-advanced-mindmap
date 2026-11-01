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

  const rootGroup = groupFor(svg, rootData)
  const childGroup = groupFor(svg, childData)

  const setMarkdown = vi.fn()
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- a\n',
    setMarkdown,
    getFoldRoot: () => rootData as unknown as FoldNode,
  })

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }

  return { press, rootGroup, childGroup, setMarkdown }
}

describe('navigation to the synthetic root', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

  it('selects a real node (not the empty root) as home', () => {
    const { press, rootGroup, childGroup } = setup()
    press('ArrowDown')
    expect(childGroup.classList.contains('advmm-selected')).toBe(true)
    expect(rootGroup.classList.contains('advmm-selected')).toBe(false)
  })

  // A leftover native text selection is painted with the same colour as the
  // node highlight but with square corners, so clear it whenever the plugin
  // changes the selection.
  it('clears any native text selection when the node selection changes', () => {
    const removeAllRanges = vi.fn()
    vi.spyOn(document, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)
    const { press } = setup()

    press('ArrowDown')

    expect(removeAllRanges).toHaveBeenCalled()
  })

  // Clearing the DOM selection while a text field owns the keyboard cancels an
  // in-flight IME composition (fcitx5/rime on Wayland): the first character
  // lands, then the field silently stops receiving text. Never touch it then.
  it('does not clear the native selection while a text input is focused', () => {
    const removeAllRanges = vi.fn()
    vi.spyOn(document, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)
    const { press } = setup()

    const field = document.createElement('input')
    document.body.append(field)
    field.focus()

    press('ArrowDown')

    expect(removeAllRanges).not.toHaveBeenCalled()
  })

  it('does not clear the native selection while a textarea is focused', () => {
    const removeAllRanges = vi.fn()
    vi.spyOn(document, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)
    const { press } = setup()

    const field = document.createElement('textarea')
    document.body.append(field)
    field.focus()

    press('ArrowDown')

    expect(removeAllRanges).not.toHaveBeenCalled()
  })

  it('moves up to the root with h', () => {
    const { press, rootGroup, childGroup } = setup()
    press('ArrowDown')            // select the top-level child
    press('h')
    expect(rootGroup.classList.contains('advmm-selected')).toBe(true)
    expect(childGroup.classList.contains('advmm-selected')).toBe(false)
  })

  it('moves back down to the first child with l', () => {
    const { press, rootGroup, childGroup } = setup()
    press('ArrowDown')
    press('h')                    // root
    press('l')
    expect(childGroup.classList.contains('advmm-selected')).toBe(true)
    expect(rootGroup.classList.contains('advmm-selected')).toBe(false)
  })

  it('stays on the root when h is pressed again', () => {
    const { press, rootGroup } = setup()
    press('ArrowDown')
    press('h')
    press('h')
    expect(rootGroup.classList.contains('advmm-selected')).toBe(true)
  })

  it('does not edit or remove the synthetic root', () => {
    const { press, setMarkdown } = setup()
    press('ArrowDown')
    press('h')                    // root
    press('Backspace')
    press('i')
    press('Enter')
    expect(setMarkdown).not.toHaveBeenCalled()
    expect(document.querySelector('input')).toBeNull()
  })
})

describe('navigation into a code block', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setup() {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const codeData = { content: '<pre>code</pre>', children: [], payload: { advmmSourcePath: [0, 0] } }
    const rootData = { content: 'Root', children: [codeData], payload: { advmmSourcePath: [0] } }
    const rootGroup = groupFor(svg, rootData)
    const codeGroup = groupFor(svg, codeData)

    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => '# Root\n```\ncode\n```\n',
      setMarkdown: vi.fn(),
      getFoldRoot: () => rootData as unknown as FoldNode,
    })

    const press = (key: string, init: KeyboardEventInit = {}) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    }

    return { press, rootGroup, codeGroup, svg }
  }

  it('reaches the code block with l', () => {
    const { press, rootGroup, codeGroup } = setup()
    press('ArrowDown')            // home = heading
    expect(rootGroup.classList.contains('advmm-selected')).toBe(true)

    press('l')                    // into the code block
    expect(codeGroup.classList.contains('advmm-selected')).toBe(true)
    expect(rootGroup.classList.contains('advmm-selected')).toBe(false)
  })

  it('walks back up to the heading with h', () => {
    const { press, rootGroup, codeGroup } = setup()
    press('ArrowDown')
    press('l')
    press('h')
    expect(rootGroup.classList.contains('advmm-selected')).toBe(true)
    expect(codeGroup.classList.contains('advmm-selected')).toBe(false)
  })

  it('selects the code block on click', () => {
    const { codeGroup } = setup()
    codeGroup.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    expect(codeGroup.classList.contains('advmm-selected')).toBe(true)
  })
})
