// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { editorWidth, MIN_EDITOR_WIDTH, nodeBorderRadius, nodeContentElement, nodeFont, nodeMaxWidth, nodeMetrics, openInlineInput, type InlineInputHandlers, type Rect } from './inline-input'


const RECT = { left: 10, top: 20, width: 200 }

function domRect(width: number, height = 20): DOMRect {
  return { width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
}

/**
 * jsdom has no layout, so the editor could not measure anything. Fake a font
 * where every character is 10px wide: the editor's hidden mirror reports the
 * length of the text it was given, everything else measures as empty.
 */
function stubTextMetrics(pxPerCharacter = 10) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('advmm-node-editor-measure')) {
      return domRect(((this as HTMLElement).textContent ?? '').length * pxPerCharacter)
    }
    return domRect(0, 0)
  })
}

function setup(value = 'hello'): { input: HTMLTextAreaElement, handlers: InlineInputHandlers } {
  const handlers: InlineInputHandlers = {
    save: vi.fn(),
    commit: vi.fn(),
    addChild: vi.fn(),
    cancel: vi.fn(),
  }
  const input = openInlineInput(value, () => RECT, handlers)
  return { input, handlers }
}

beforeEach(() => stubTextMetrics())

afterEach(() => vi.restoreAllMocks())

describe('openInlineInput', () => {
  it('positions the input at the node rect and matches the node box until typing', () => {
    const { input } = setup('hello')
    expect(input.style.left).toBe('10px')
    expect(input.style.top).toBe('20px')
    // When the rect is the node's own box (the default) the editor starts at
    // the node's rendered width, to cover ordered-list prefixes.
    expect(input.style.width).toBe('200px')
  })

  it('sizes to the text while the rect belongs to an anchor node', () => {
    // A node that is still being created is drawn on its anchor (its parent or
    // previous sibling), so that box says nothing about the text being typed.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('New node', () => ({ left: 0, top: 0, width: 60, trustWidth: false }), handlers)
    expect(input.style.width).toBe('81px')
  })

  it('covers the node box once the rect is the edited node\'s own', () => {
    // markmap can render the node wider than its source text (`43. New node`), so
    // an editor sized to the text alone leaves the node's tail sticking out - the
    // "two boxes, two texts" bug.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    // Over an anchor (the new node is not rendered yet): size to the text only.
    const anchor = openInlineInput('New node', () => ({ left: 0, top: 0, width: 60, trustWidth: false }), handlers)
    expect(anchor.style.width).toBe('81px')
    anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    // Over the real node: cover its box, exactly like a normal edit.
    const covering = openInlineInput('New node', () => ({ left: 0, top: 0, width: 140, trustWidth: true }), handlers)
    expect(covering.style.width).toBe('140px')
  })

  it('hides the node it stands in for and shows it again on close', () => {
    // One copy of the text: the input replaces the node's own text instead of
    // sitting on top of it (where a mismatch shows both).
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const node = document.createElement('div')
    node.style.visibility = 'visible'
    const input = openInlineInput('a', () => ({ left: 0, top: 0, width: 20, mask: node }), handlers)
    expect(node.style.visibility).toBe('hidden')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(node.style.visibility).toBe('visible')
  })

  it('unmasks the previous node when the input moves onto the real node', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const anchor = document.createElement('div')
    const node = document.createElement('div')
    let mask: Element = anchor
    const input = openInlineInput('a', () => ({ left: 0, top: 0, width: 20, trustWidth: mask === node, mask }), handlers)
    expect(anchor.style.visibility).toBe('hidden')
    expect(node.style.visibility).toBe('')

    // The new node has been rendered; the input snaps onto it.
    mask = node
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(anchor.style.visibility).toBe('')
    expect(node.style.visibility).toBe('hidden')
  })

  it('keeps a degenerate empty box usable', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('', () => ({ left: 0, top: 0, width: 0 }), handlers)
    expect(input.style.width).toBe(`${MIN_EDITOR_WIDTH}px`)
  })

  it('grows with the text after typing', () => {
    // Starts at the node's rendered width, then tracks the measured text
    // content once the user types.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('abcdefgh', () => ({ left: 0, top: 0, width: 500 }), handlers)
    expect(input.style.width).toBe('500px')

    input.value = 'abcdefghij'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.style.width).toBe('101px')

    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.style.width).toBe(`${MIN_EDITOR_WIDTH}px`)
  })

  it('caps at the node\'s max width', () => {
    // Starts at the node's rendered width; maxWidth kicks in after the user
    // types.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('abcdefgh', () => ({ left: 0, top: 0, width: 500, maxWidth: 60 }), handlers)
    expect(input.style.width).toBe('500px')

    input.value = 'abcdefghij'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.style.width).toBe('60px')

    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.style.width).toBe('31px')
  })

  it('keeps one line while the text still fits the node', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('abc', () => ({ left: 0, top: 0, width: 31, height: 20, lineHeight: 20 }), handlers)
    expect(input.style.height).toBe('20px')
  })

  it('tracks the content height at all times', () => {
    // Height is always content-based (scrollHeight with lineHeight floor),
    // never borrowed from the node's rendered box (which can include
    // nodeMinHeight padding or belong to a different anchor node).
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('abc', () => ({ left: 0, top: 0, width: 31, height: 60, lineHeight: 20 }), handlers)
    expect(input.style.height).toBe('20px')

    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 60 })
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.style.height).toBe('60px')
  })

  it('uses border-box sizing and content-based height', () => {
    // Height is derived from content (scrollHeight with lineHeight floor), not
    // from the node's rendered box height which may be taller.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('x', () => ({ left: 0, top: 0, width: 200, height: 44, lineHeight: 20 }), handlers)
    expect(input.style.height).toBe('20px')
    expect(input.style.boxSizing).toBe('border-box')
  })

  it('re-measures the content height on every position call', () => {
    // Resetting height to 'auto' ensures scrollHeight always reflects the real
    // content, never a previously latched tall measurement.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    let rect = { left: 0, top: 0, width: 200, height: 78, lineHeight: 20 }
    const input = openInlineInput('x', () => rect, handlers)
    expect(input.style.height).toBe('20px')

    // Simulate a wrapped node: scrollHeight reports the taller content.
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      get: () => 60,
    })

    rect = { left: 0, top: 0, width: 200, height: 39, lineHeight: 20 }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.style.height).toBe('60px')
  })

  it('matches the node font size when provided', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('x', () => ({ left: 0, top: 0, width: 200, fontSize: 48 }), handlers)
    expect(input.style.fontSize).toBe('48px')
  })

  it('rounds the input like the node at the current zoom level', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('x', () => ({ left: 0, top: 0, width: 200, borderRadius: 24 }), handlers)
    expect(input.style.borderRadius).toBe('24px')
  })

  it('leaves the radius unset when the rect has none', () => {
    const { input } = setup()
    expect(input.style.borderRadius).toBe('')
  })

  it('leaves the font and height unset when the rect has none', () => {
    const { input } = setup()
    expect(input.style.height).toBe('')
    expect(input.style.fontSize).toBe('')
  })

  it('selects all text by default', () => {
    const { input } = setup('hello')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(5)
  })

  it('places the caret at the end when asked', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('hello', () => RECT, handlers, { select: 'end' })
    expect(input.selectionStart).toBe(5)
    expect(input.selectionEnd).toBe(5)
  })

  it('exits editing and commits on Enter', () => {
    const { input, handlers } = setup()
    input.value = 'world'

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(input.isConnected).toBe(false)
    expect(handlers.commit).toHaveBeenCalledWith('world')
  })

  it('does not create a sibling on Enter', () => {
    const { input, handlers } = setup()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(handlers.addChild).not.toHaveBeenCalled()
    expect(handlers.save).not.toHaveBeenCalled()
  })

  it('exits editing and adds a child on Tab', () => {
    const { input, handlers } = setup()
    input.value = 'child'

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))

    expect(input.isConnected).toBe(false)
    expect(handlers.addChild).toHaveBeenCalledWith('child')
  })

  it('exits editing and cancels on Escape', () => {
    const { input, handlers } = setup()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(input.isConnected).toBe(false)
    expect(handlers.cancel).toHaveBeenCalled()
  })

  it('does not save twice when blur follows Enter', () => {
    const { input, handlers } = setup()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    input.dispatchEvent(new FocusEvent('blur'))

    expect(handlers.commit).toHaveBeenCalledTimes(1)
    expect(handlers.save).not.toHaveBeenCalled()
  })

  it('exits editing and saves on blur', () => {
    const { input, handlers } = setup()
    input.value = 'bye'

    input.dispatchEvent(new FocusEvent('blur'))

    expect(input.isConnected).toBe(false)
    expect(handlers.save).toHaveBeenCalledWith('bye')
  })
})

describe('nodeContentElement', () => {
  it('finds the inner content box markmap renders', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    fo.setAttribute('class', 'markmap-foreign')
    const outer = document.createElement('div')
    const inner = document.createElement('div')
    outer.append(inner)
    fo.append(outer)
    group.append(fo)

    expect(nodeContentElement(group)).toBe(inner)
  })

  it('falls back to the group when no content box exists', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    expect(nodeContentElement(group)).toBe(group)
  })
})

describe('node metrics cost', () => {
  it('reads computed styles and the zoom transform once per editor measurement', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const content = document.createElement('div')
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontSize: '20px', lineHeight: '30px', fontFamily: 'Inter', fontWeight: '300', borderRadius: '4px',
    } as CSSStyleDeclaration)
    const ctm = vi.fn(() => ({ a: 3, b: 0 }))
    ;(group as any).getScreenCTM = ctm
    expect(nodeMetrics(content, group)).toEqual({ fontSize: 60, lineHeight: 90, fontFamily: 'Inter', fontWeight: '300', borderRadius: 12 })
    expect(style).toHaveBeenCalledOnce()
    expect(ctm).toHaveBeenCalledOnce()
    style.mockRestore()
  })
})

describe('nodeFont', () => {
  function withScale(scale: number) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const content = document.createElement('div')
    content.style.fontSize = '20px'
    content.style.lineHeight = '30px'
    group.append(content)
    ;(group as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () =>
      ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }) as DOMMatrix
    return { group, content }
  }

  it('scales the computed font size and line height by the node transform', () => {
    const { group, content } = withScale(3)
    expect(nodeFont(content, group)).toMatchObject({ fontSize: 60, lineHeight: 90 })
  })

  it('returns the computed sizes unchanged at 1x', () => {
    const { group, content } = withScale(1)
    expect(nodeFont(content, group)).toMatchObject({ fontSize: 20, lineHeight: 30 })
  })

  it('returns the computed size when the transform is unavailable', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const content = document.createElement('div')
    content.style.fontSize = '18px'
    group.append(content)
    expect(nodeFont(content, group).fontSize).toBe(18)
  })

  // The editor must wrap at the node's own wrap points, which needs the same
  // family and weight (markmap defaults to a light `300`).
  it('copies the family and weight used to draw the node', () => {
    const { group, content } = withScale(1)
    content.style.fontFamily = 'Inter'
    content.style.fontWeight = '300'
    expect(nodeFont(content, group)).toMatchObject({ fontFamily: 'Inter', fontWeight: '300' })
  })

  it('returns undefined when the metrics cannot be measured', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const content = document.createElement('div')
    group.append(content)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({} as CSSStyleDeclaration)
    expect(nodeFont(content, group)).toEqual({
      fontSize: undefined,
      lineHeight: undefined,
      fontFamily: undefined,
      fontWeight: undefined,
    })
  })
})

describe('nodeBorderRadius', () => {
  function withScale(scale: number, radius: string) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const content = document.createElement('div')
    group.append(content)
    ;(group as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () =>
      ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }) as DOMMatrix
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ borderRadius: radius } as CSSStyleDeclaration)
    return { group, content }
  }

  it('scales the node radius by the zoom level', () => {
    const { group, content } = withScale(3, '4px')
    expect(nodeBorderRadius(content, group)).toBe(12)
  })

  it('returns the un-scaled radius at 1x', () => {
    const { group, content } = withScale(1, '4px')
    expect(nodeBorderRadius(content, group)).toBe(4)
  })

  it('returns 0 when the node has no radius', () => {
    const { group, content } = withScale(2, '')
    expect(nodeBorderRadius(content, group)).toBe(0)
  })
})

describe('nodeMaxWidth', () => {
  function withWidth(scale: number, inlineWidth?: string, globalWidth?: string) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'markmap')
    if (globalWidth) svg.style.setProperty('--markmap-max-width', globalWidth)

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    const outer = document.createElement('div')
    const content = document.createElement('div')
    if (inlineWidth) content.style.width = inlineWidth
    outer.append(content)
    foreign.append(outer)
    group.append(foreign)
    svg.append(group)
    ;(group as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () =>
      ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }) as DOMMatrix

    return { group, content }
  }

  it('uses a node\'s own resized width, scaled by the zoom', () => {
    const { group } = withWidth(2, '120px', '300px')
    expect(nodeMaxWidth(group)).toBe(240)
  })

  it('falls back to the global max width', () => {
    const { group } = withWidth(2, undefined, '300px')
    expect(nodeMaxWidth(group)).toBe(600)
  })

  it('returns undefined when the node is never wrapped', () => {
    const { group } = withWidth(1)
    expect(nodeMaxWidth(group)).toBeUndefined()
  })
})

describe('wrapping editor', () => {
  // A node's text is wrapped by markmap at `maxWidth`, so the editor has to
  // wrap it too: a single-line `<input>` sized to the node box clips (or scrolls
  // away) everything that does not fit, which is what "the sentence is cut off
  // by the rounded box" looked like.
  it('edits in a textarea, which can wrap like the node', () => {
    const { input } = setup()
    expect(input.tagName).toBe('TEXTAREA')
  })

  it('applies the node line height and font so the wrapping matches', () => {
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput(
      'x',
      () => ({ ...RECT, lineHeight: 30, fontFamily: 'Inter', fontWeight: '300' }),
      handlers,
    )
    expect(input.style.lineHeight).toBe('30px')
    expect(input.style.fontFamily).toBe('Inter')
    expect(input.style.fontWeight).toBe('300')
  })

  // Obsidian styles `textarea` with its own padding/border, which would leave
  // the editor a narrower content box than the node, wrapping the text earlier.
  it('zeroes the padding and border that would shrink the text box', () => {
    const { input } = setup()
    expect(input.style.padding).toBe('0px')
    expect(input.style.borderStyle).toBe('none')
  })

  it('grows past a single line when the content wraps', () => {
    // scrollHeight is the real content height; the editor follows it.
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput('x', () => ({ ...RECT, height: 20, lineHeight: 20 }), handlers)
    expect(input.style.height).toBe('20px')

    // A node whose text needs an extra line (or a longer text being typed).
    Object.defineProperty(input, 'scrollHeight', { value: 60, configurable: true })
    input.dispatchEvent(new Event('input'))

    expect(input.style.height).toBe('60px')
  })

  it('keeps a node on a single line when a newline is pasted', () => {
    const { input, handlers } = setup()
    input.value = 'one\ntwo'

    input.dispatchEvent(new FocusEvent('blur'))

    expect(handlers.save).toHaveBeenCalledWith('one two')
  })

  it('keeps a node on a single line when a newline reaches Enter', () => {
    const { input, handlers } = setup()
    input.value = 'one\r\ntwo'

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(handlers.commit).toHaveBeenCalledWith('one two')
  })
})

describe('position tracking', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function setupTracking(duration = 500) {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queue.push(callback)
      return queue.length
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { queue[handle - 1] = () => {} })

    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const node = { left: 0, top: 0 }
    const handlers: InlineInputHandlers = { save: vi.fn(), commit: vi.fn(), addChild: vi.fn(), cancel: vi.fn() }
    const input = openInlineInput(
      'x',
      () => ({ left: node.left, top: node.top, width: 200 }),
      handlers,
      { track: true, trackDuration: duration },
    )

    /** Runs `steps` animation frames, letting `onFrame` move the node. */
    const pump = (steps: number, onFrame?: (frame: number) => void) => {
      for (let i = 0; i < steps && queue.length > 0; i++) {
        const callback = queue.shift()!
        now += 16
        onFrame?.(i)
        callback(now)
      }
    }

    return { input, node, pump, pending: () => queue.length }
  }

  it('follows the node while it is moving', () => {
    const { input, node, pump } = setupTracking()

    pump(40, () => { node.left += 1 })

    expect(node.left).toBe(40)
    expect(input.style.left).toBe('40px')
  })

  it('keeps watching after the animation window, and stops when the editor closes', () => {
    const { input, node, pump, pending } = setupTracking()

    // ~640ms of animation, then the node settles.
    pump(40, () => { node.left += 1 })
    pump(60)

    // Still watching (a late pan or re-render must not leave it behind)...
    expect(pending()).toBeGreaterThan(0)
    expect(input.style.left).toBe('40px')

    // ...until the editor goes away.
    input.remove()
    pump(2)
    expect(pending()).toBe(0)
  })

  it('catches up with a node that moved without any change event', () => {
    // The real-world case behind the "two New node boxes" bug: the node ends up
    // somewhere the editor never heard about (a follow window that expired, a
    // pan, a re-render that produced no childList record).
    const { input, node, pump } = setupTracking()

    pump(60) // 960ms: well past the 800ms animation window
    node.left = 500
    pump(20) // 320ms, more than the idle re-check interval

    expect(input.style.left).toBe('500px')
  })
})
