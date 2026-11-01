// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor, type NodeEditorOptions } from './node-editor'
import { strings } from 'src/translation'


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

/** `apple` (banana, cherry) and `apricot`. */
const MARKDOWN = '- apple\n  - banana\n  - cherry\n- apricot\n'

const PATHS: number[][] = [[0], [0, 0], [0, 1], [1]]

/** Mounts a second, independent editor without wiping the existing DOM. */
function mountAnother(): { container: HTMLDivElement; input: () => HTMLInputElement | null } {
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)
  for (const path of PATHS) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'markmap-node')
    ;(group as unknown as { __data__: unknown }).__data__ = {
      content: path.join('.'),
      children: [],
      payload: { advmmSourcePath: path },
    }
    svg.append(group)
  }
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => MARKDOWN,
    setMarkdown: () => {},
  })
  return { container, input: () => container.querySelector<HTMLInputElement>('.advmm-search-input') }
}

function setup(extra: Partial<NodeEditorOptions> = {}) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  for (const path of PATHS) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'markmap-node')
    ;(group as unknown as { __data__: unknown }).__data__ = {
      content: path.join('.'),
      children: [],
      payload: { advmmSourcePath: path },
    }
    svg.append(group)
  }

  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => MARKDOWN,
    setMarkdown: () => {},
    ...extra,
  })

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }
  const input = () => container.querySelector<HTMLInputElement>('.advmm-search-input')
  const count = () => container.querySelector<HTMLElement>('.advmm-search-count')?.textContent ?? ''
  const groupFor = (path: number[]) =>
    Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
      .find(g => (g as unknown as { __data__: { payload: { advmmSourcePath: number[] } } }).__data__.payload.advmmSourcePath.join('.') === path.join('.'))!
  const classes = (path: number[]) => groupFor(path).getAttribute('class') ?? ''
  const type = (value: string) => {
    const el = input()!
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const pressInInput = (key: string, init: KeyboardEventInit = {}) => {
    input()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }

  return { container, press, input, count, classes, type, pressInInput }
}

describe('node editor search', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('opens a focused search input on /', () => {
    const { press, input } = setup()
    expect(input()).toBeNull()

    press('/')
    expect(input()).not.toBeNull()
    expect(document.activeElement).toBe(input())
  })

  it('highlights every match and marks the current one', () => {
    const { press, type, count, classes } = setup()
    press('/')
    type('ap')

    expect(count()).toBe('1/2')
    expect(classes([0])).toContain('advmm-search-current')
    expect(classes([0])).toContain('advmm-search-hit')
    expect(classes([1])).toContain('advmm-search-hit')
    expect(classes([1])).not.toContain('advmm-search-current')
    expect(classes([0, 0])).not.toContain('advmm-search-hit')
  })

  it('reports no results for an unmatched query', () => {
    const { press, type, count, classes } = setup()
    press('/')
    type('zzz')

    expect(count()).toBe(strings.nodeEditor.searchNoResults)
    expect(classes([0])).not.toContain('advmm-search-hit')
  })

  it('keeps typing plain n/p while the input is focused', () => {
    const { press, pressInInput, type, count, classes } = setup()
    press('/')
    type('ap')

    pressInInput('n')
    pressInInput('p')
    // The query was not navigated: still on the first match.
    expect(count()).toBe('1/2')
    expect(classes([0])).toContain('advmm-search-current')
  })

  // The view itself (or a re-render) can pull focus out of the query input. The
  // keystroke must still reach the query instead of being treated as a command
  // that closes the search.
  it('recovers when focus is stolen from the query input', () => {
    const { press, type, count, input, container } = setup()
    press('/')
    type('ap')

    // Simulate Obsidian re-focusing the editor container.
    container.focus()
    expect(document.activeElement).not.toBe(input())

    press('x') // typed while focus sits on the container
    expect(input()!.value).toBe('apx')
    expect(document.activeElement).toBe(input())
    expect(input()).not.toBeNull()
    expect(count()).toBe(strings.nodeEditor.searchNoResults)
  })

  // Two open mindmaps share the same `document`; each editor installs a
  // capture-phase keydown listener on it. A key pressed into mindmap B must
  // never drive mindmap A's open search (and vice versa).
  it('ignores Enter pressed in another mindmap while this search is open', () => {
    const a = setup()
    const b = mountAnother()

    a.press('/')
    a.type('ap')
    expect(document.activeElement).toBe(a.input())

    b.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    // A's search is untouched: still editing, still on the first match.
    expect(a.count()).toBe('1/2')
    expect(document.activeElement).toBe(a.input())
  })

  it('does not type a key from another mindmap search input into this query', () => {
    const a = setup()
    const b = mountAnother()

    a.press('/')
    a.type('ap')
    // B has its own search open too; the key really comes from B's input.
    b.container.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    const bInput = b.input()!
    bInput.value = 'b'
    bInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }))

    // The 'x' typed into B must not append to A's query.
    expect(a.input()!.value).toBe('ap')
  })

  it('re-focuses the input after opening it', async () => {
    const { press, input } = setup()
    press('/')
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    expect(document.activeElement).toBe(input())
  })

  // The view can pull focus away after any keystroke (a re-render, Obsidian
  // re-focusing its container, ...). The caret must be handed straight back.
  it('keeps the caret in the input when focus is pulled away', async () => {
    const { press, type, input, container } = setup()
    press('/')
    type('a')

    container.focus() // no mouse involved: not an intentional click-away
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))

    expect(document.activeElement).toBe(input())
  })

  it('does not fight a real click outside the search bar', async () => {
    const { press, type, input } = setup()
    press('/')
    type('a')

    const other = document.createElement('input')
    document.body.append(other)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    other.focus()
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))

    expect(document.activeElement).toBe(other)
    expect(input()).not.toBeNull()
  })

  // Clicking the canvas is an intentional way to leave the query, so the next
  // keystroke must be a normal command rather than being pulled back in.
  it('leaves edit mode when the canvas is clicked', () => {
    const { press, type, input, container } = setup()
    press('/')
    type('ap')

    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    press('x')

    expect(input()).toBeNull()
  })

  // Regression: `applyHighlight` must not clear the DOM selection out from
  // under the focused query input — doing so cancels an in-flight IME
  // composition and the query stops receiving text after the first character.
  it('does not clear the native selection while typing in the query', () => {
    const removeAllRanges = vi.fn()
    vi.spyOn(document, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)
    const { press, type, input } = setup()
    press('/')
    expect(document.activeElement).toBe(input())

    type('ap')

    expect(removeAllRanges).not.toHaveBeenCalled()
  })

  // Moving the caret mid-composition would relocate (or cancel) the preedit.
  it('does not move the caret while an IME composition is active', async () => {
    const { press, input } = setup()
    press('/')
    const el = input()!
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const setSelectionRange = vi.spyOn(el, 'setSelectionRange')

    el.dispatchEvent(new Event('focusout', { bubbles: true }))
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))

    expect(setSelectionRange).not.toHaveBeenCalled()
  })

  // A Chinese/Japanese IME uses Enter and the arrow keys to pick a candidate;
  // those keystrokes must reach the IME rather than drive the search navigation.
  it('does not leave the input while an IME composition is active', () => {
    const { press, pressInInput, type, input } = setup()
    press('/')
    type('ni')

    pressInInput('Enter', { isComposing: true })
    expect(document.activeElement).toBe(input())
    expect(input()!.value).toBe('ni')

    pressInInput('ArrowDown', { isComposing: true })
    expect(document.activeElement).toBe(input())
  })

  it('lets arrows and Ctrl+n step through matches while typing', () => {
    const { press, pressInInput, type, count } = setup()
    press('/')
    type('ap')

    pressInInput('ArrowDown')
    expect(count()).toBe('2/2')
    pressInInput('ArrowUp')
    expect(count()).toBe('1/2')
    pressInInput('n', { ctrlKey: true })
    expect(count()).toBe('2/2')
  })

  it('locates the first match on Enter even after stepping through matches', () => {
    const { press, pressInInput, type, count } = setup()
    press('/')
    type('ap')
    pressInInput('ArrowDown')
    expect(count()).toBe('2/2')

    pressInInput('Enter')
    expect(count()).toBe('1/2')
  })

  // `Enter`/`n`/`p` must bring the match onto the canvas, not just select it.
  it('centers the matched node when Enter locates it', async () => {
    const centerNode = vi.fn()
    const { press, pressInInput, type } = setup({ centerNode })
    press('/')
    type('ap')

    pressInInput('Enter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(centerNode).toHaveBeenCalledTimes(1)
    const node = centerNode.mock.calls[0][0] as { payload: { advmmSourcePath: number[] } }
    expect(node.payload.advmmSourcePath).toEqual([0])
  })

  it('centers every match stepped to with n and p', async () => {
    const centerNode = vi.fn()
    const { press, pressInInput, type } = setup({ centerNode })
    press('/')
    type('ap')
    pressInInput('Enter')
    await new Promise(resolve => setTimeout(resolve, 0))

    press('n')
    await new Promise(resolve => setTimeout(resolve, 0))
    press('p')
    await new Promise(resolve => setTimeout(resolve, 0))

    const paths = centerNode.mock.calls.map(([node]) => (node as { payload: { advmmSourcePath: number[] } }).payload.advmmSourcePath)
    expect(paths).toEqual([[0], [1], [0]])
  })

  // Renders without a centering callback still get the old minimal pan.
  it('falls back to revealing the match when it cannot be centered', async () => {
    const ensureVisible = vi.fn()
    const { press, pressInInput, type } = setup({ ensureVisible })
    press('/')
    type('ap')

    pressInInput('Enter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(ensureVisible).toHaveBeenCalledTimes(1)
  })

  it('leaves the input when Enter exits edit mode', () => {
    const { press, pressInInput, type, input, container } = setup()
    press('/')
    type('ap')
    expect(document.activeElement).toBe(input())

    pressInInput('Enter')
    expect(document.activeElement).not.toBe(input())
    expect(document.activeElement).toBe(container)
  })

  it('steps through the matches with n and p after Enter', () => {
    const { press, pressInInput, type, count, classes } = setup()
    press('/')
    type('ap')
    pressInInput('Enter')

    press('n')
    expect(count()).toBe('2/2')
    expect(classes([1])).toContain('advmm-search-current')
    expect(classes([0])).not.toContain('advmm-search-current')

    press('n')  // wraps around
    expect(count()).toBe('1/2')

    press('p')  // wraps backward
    expect(count()).toBe('2/2')
  })

  it('re-enters edit mode with / and puts the caret at the end', () => {
    const { press, pressInInput, type, input } = setup()
    press('/')
    type('ap')
    pressInInput('Enter')
    press('/')

    const el = input()!
    expect(document.activeElement).toBe(el)
    expect(el.selectionStart).toBe(el.value.length)
    expect(el.selectionEnd).toBe(el.value.length)
  })

  it('starts with an empty query the first time', () => {
    const { press, input } = setup()
    press('/')
    expect(input()!.value).toBe('')
  })

  it('restores the last query after leaving edit mode and closing', () => {
    const { press, pressInInput, type, input, count } = setup()
    press('/')
    type('ap')
    pressInInput('Enter')  // leave edit mode
    press('Escape')        // close the search
    press('/')             // reopen

    const el = input()!
    expect(el.value).toBe('ap')
    expect(count()).toBe('1/2')
    expect(el.selectionStart).toBe(2)
    expect(el.selectionEnd).toBe(2)
  })

  it('restores the last query after closing while editing', () => {
    const { press, pressInInput, type, input } = setup()
    press('/')
    type('ap')
    pressInInput('Escape')
    press('/')

    expect(input()!.value).toBe('ap')
  })

  it('closes the search and clears the highlighting on Escape', () => {
    const { press, type, input, classes } = setup()
    press('/')
    type('ap')
    press('Escape')

    expect(input()).toBeNull()
    expect(classes([0])).not.toContain('advmm-search-hit')
    expect(classes([1])).not.toContain('advmm-search-current')
  })

  it('keeps the current match selected after closing', () => {
    const { press, pressInInput, type, classes } = setup()
    press('/')
    type('ap')
    pressInInput('Enter')
    press('n')
    press('Escape')

    expect(classes([1])).toContain('advmm-selected')
  })

  it('centers a match that had to be revealed from inside a folded subtree', async () => {
    const centerNode = vi.fn()
    const revealChildren = vi.fn().mockResolvedValue(undefined)
    const root = {
      children: [
        {
          content: 'apple',
          children: [{ content: 'banana', children: [] }],
          payload: { fold: 1 },
        },
        { content: 'apricot', children: [] },
      ],
    }

    const { press, pressInInput, type } = setup({ getFoldRoot: () => root, revealChildren, centerNode })
    press('/')
    type('banana')
    pressInInput('Enter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(revealChildren).toHaveBeenCalledTimes(1)
    expect(centerNode).toHaveBeenCalledTimes(1)
  })

  it('unfolds a folded ancestor to reveal a hidden match', async () => {
    const revealChildren = vi.fn().mockResolvedValue(undefined)
    const root = {
      children: [
        {
          content: 'apple',
          children: [
            { content: 'banana', children: [] },
            { content: 'cherry', children: [] },
          ],
          payload: { fold: 1 },
        },
        { content: 'apricot', children: [] },
      ],
    }

    const { press, pressInInput, type } = setup({ getFoldRoot: () => root, revealChildren })
    press('/')
    type('banana')
    pressInInput('Enter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(revealChildren).toHaveBeenCalledTimes(1)
  })

  it('does not unfold when the match is already visible', async () => {
    const revealChildren = vi.fn().mockResolvedValue(undefined)
    const root = {
      children: [
        { content: 'apple', children: [{ content: 'banana', children: [] }] },
        { content: 'apricot', children: [] },
      ],
    }

    const { press, pressInInput, type } = setup({ getFoldRoot: () => root, revealChildren })
    press('/')
    type('banana')
    pressInInput('Enter')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(revealChildren).not.toHaveBeenCalled()
  })
})
