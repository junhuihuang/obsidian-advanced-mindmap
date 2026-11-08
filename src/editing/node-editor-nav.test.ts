// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import type { FoldNode } from './fold'
import { parseSource } from './source-tree'

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

// A path level the canvas does not draw (a paragraph markmap dropped, or a node
// the canvas has no source path for): the list items sit one level below the
// heading on the canvas while their source path is two levels deeper.
describe('navigation across a level the canvas does not draw', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const MARKDOWN = '# T\n\nprose\n\n- one\n- two\n'

  /** `proseDrawn` = the map before the switch was flipped, paragraph still on it. */
  function setup(proseDrawn = false) {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    interface FakeNode { content: string; children: FakeNode[]; payload: { advmmSourcePath: number[] } }
    const node = (content: string, path: number[]): FakeNode => ({ content, children: [], payload: { advmmSourcePath: path } })
    const heading = node('T', [0])
    const prose = node('prose', [0, 0])
    const one = node('one', [0, 0, 0])
    const two = node('two', [0, 0, 1])

    const headingGroup = groupFor(svg, heading)
    const proseGroup = groupFor(svg, prose)
    const oneGroup = groupFor(svg, one)
    const twoGroup = groupFor(svg, two)
    const roots = parseSource(MARKDOWN)

    heading.children = proseDrawn ? [prose] : [one, two]
    if (proseDrawn) prose.children = [one, two]
    else proseGroup.remove()

    const editor = attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => MARKDOWN,
      getSourceRoots: () => roots,
      setMarkdown: vi.fn(),
      getFoldRoot: () => ({ children: [heading] }) as unknown as FoldNode,
    })

    const press = (key: string, init: KeyboardEventInit = {}) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    }
    const selected = () => [
      [headingGroup, 'T'],
      [proseGroup, 'prose'],
      [oneGroup, 'one'],
      [twoGroup, 'two'],
    ].filter(([group]) => (group as SVGGElement).classList.contains('advmm-selected'))
      .map(([, text]) => text)

    /** What the renderer does after it re-rendered without the prose nodes. */
    const dropProse = () => {
      proseGroup.remove()
      heading.children = [one, two]
      editor.dropVanishedSelection()
    }

    return { press, selected, dropProse, editor }
  }

  it('walks from the heading into the list and back across the hidden paragraph', () => {
    const { press, selected } = setup()
    press('ArrowDown')
    expect(selected()).toEqual(['T'])

    press('l')
    expect(selected()).toEqual(['one'])

    press('j')
    expect(selected()).toEqual(['two'])

    press('h')
    expect(selected()).toEqual(['T'])
  })

  // The empty node markmap leaves in front of a list has no source path, so it
  // cannot be selected: revealing one level must not stop there.
  it('reveals the first selectable child of a folded node', async () => {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const heading: Record<string, unknown> = { content: 'T', children: [], payload: { advmmSourcePath: [0], fold: 1 } }
    const item = { content: 'one', children: [], payload: { advmmSourcePath: [0, 0, 0] } }
    // The wrapper markmap builds for the paragraph above the list.
    const wrapper = { content: '', children: [item], payload: {} }
    heading.children = [wrapper]

    const headingGroup = groupFor(svg, heading as never)
    const itemGroup = groupFor(svg, item)
    // Folded: the render takes the subtree out of the DOM.
    itemGroup.remove()

    const revealChildren = vi.fn(async () => {
      heading.payload = { advmmSourcePath: [0], fold: 0 }
      svg.append(itemGroup)
    })
    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => MARKDOWN,
      getSourceRoots: () => parseSource(MARKDOWN),
      setMarkdown: vi.fn(),
      getFoldRoot: () => ({ children: [heading] }) as unknown as FoldNode,
      revealChildren,
    })

    headingGroup.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(revealChildren).toHaveBeenCalledTimes(1)
    expect(itemGroup.classList.contains('advmm-selected')).toBe(true)
  })

  it('moves the cursor off a selected paragraph that left the canvas', () => {
    const { press, selected, dropProse } = setup(true)
    press('ArrowDown')
    press('l')
    expect(selected()).toEqual(['prose'])

    dropProse()
    expect(selected()).toEqual(['T'])

    // The arrow keys work again instead of pointing at a node that is not drawn.
    press('l')
    expect(selected()).toEqual(['one'])
  })
})
