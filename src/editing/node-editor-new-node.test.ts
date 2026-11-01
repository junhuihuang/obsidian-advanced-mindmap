// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import { parseSource, type SourceNode } from './source-tree'

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

interface Harness {
  /** Renders the mindmap the way the plugin's renderer does: one group per node. */
  render: (markdown: string) => void
  press: (key: string) => void
  select: (content: string) => void
  input: () => HTMLTextAreaElement | null
  /** Content rect of the rendered node with the given text. */
  box: (content: string) => { left: number, top: number } | null
  /** Number of rendered nodes showing `text`. */
  count: (text: string) => number
  /** Puts a node's box at `left`, like a frame of markmap's position animation. */
  move: (content: string, left: number) => void
  /** Horizontal gap between the editor and the node it is supposed to edit. */
  editorOffsetFrom: (content: string) => number | null
  /** Width of the input, in the harness' fake node geometry. */
  editorWidth: () => number | null
  /** The node's rendered text element, to check whether the editor hid it. */
  nodeLabel: (content: string) => Element | null
  releaseWrite: () => void
  destroy: () => void
}

/**
 * Builds a mindmap where every node sits 100px to the right of the previous one
 * (in pre-order), so "which node is the editor over" is a plain number
 * comparison. The write is
 * held until `releaseWrite()`, which is how the real plugin behaves on a slow
 * device: the editor opens before the (async) render lands.
 */
function setup(markdown: string): Harness {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  let md = markdown
  let pending: (() => void) | null = null
  // Where each node's box currently is: the tests move it to imitate the frames
  // of markmap's position animation.
  const lefts = new Map<string, number>()

  const render = (next: string) => {
    md = next
    svg.replaceChildren()
    lefts.clear()
    // Every node gets its own column, so "the editor is over node X" is exact.
    let column = 0
    const walk = (nodes: SourceNode[], parentPath: number[]) => {
      nodes.forEach((node, index) => {
        const path = [...parentPath, index]
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        group.setAttribute('class', 'markmap-node')
        ;(group as unknown as { __data__: unknown }).__data__ = {
          content: node.text,
          children: [],
          // `lines` is what the editor uses to find a just-inserted node.
          payload: { advmmSourcePath: path, lines: `${node.line},${node.endLine}` },
        }
        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
        fo.setAttribute('class', 'markmap-foreign')
        const outer = document.createElement('div')
        const content = document.createElement('div')
        lefts.set(node.text, column++ * 100)
        content.getBoundingClientRect = () =>
          ({ left: lefts.get(node.text) ?? 0, top: 0, width: 50, height: 20 }) as DOMRect
        outer.append(content)
        fo.append(outer)
        group.append(fo)
        svg.append(group)
        walk(node.children, path)
      })
    }
    walk(parseSource(md), [])
  }

  render(markdown)

  const editor = attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => md,
    setMarkdown: () => new Promise<void>(resolve => { pending = resolve }),
    getFoldRoot: () => ({ children: [] }),
    applyFoldPlan: () => {},
  })

  const nodeWith = (content: string) => Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
    .find(group => ((group as any).__data__.content as string).trim() === content)

  return {
    render,
    press: key => container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    select: content => nodeWith(content)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    input: () => document.querySelector<HTMLTextAreaElement>('textarea.advmm-node-editor'),
    box: content => {
      const group = nodeWith(content)
      if (!group) return null
      const rect = group.querySelector('.markmap-foreign > div > div')!.getBoundingClientRect()
      return { left: rect.left, top: rect.top }
    },
    count: text => Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
      .filter(group => ((group as any).__data__.content as string).trim() === text).length,
    move: (content, left) => { lefts.set(content, left) },
    editorOffsetFrom: content => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea.advmm-node-editor')
      const box = nodeWith(content)
      if (!input || !box) return null
      const rect = box.querySelector('.markmap-foreign > div > div')!.getBoundingClientRect()
      return Math.abs(parseFloat(input.style.left) - rect.left)
    },
    editorWidth: () => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea.advmm-node-editor')
      return input ? parseFloat(input.style.width) : null
    },
    nodeLabel: content => nodeWith(content)?.querySelector('.markmap-foreign') ?? null,
    releaseWrite: () => { pending?.(); pending = null },
    destroy: () => {
      editor.destroy()
      document.querySelectorAll('textarea.advmm-node-editor').forEach(element => element.remove())
    },
  }
}

const frames = async (count = 3) => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame)
}

let clock = 0

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('the new node editor follows the node that is actually rendered', () => {
  it('moves onto the new node when the render lands after the animation window', async () => {
    const harness = setup('- a\n')
    harness.select('a')
    harness.press('Enter')

    // The editor opens immediately, over the anchor node (`a` at x=0), because the
    // new node does not exist yet.
    expect(harness.input()?.value).toBe('New node')
    expect(harness.editorOffsetFrom('a')).toBe(0)
    expect(harness.count('New node')).toBe(0)

    // The node animation window passes before the render lands at all.
    clock = 10_000
    await frames()

    // Now the renderer catches up; the new node appears one level to the right.
    harness.render('- a\n- New node\n')
    harness.releaseWrite()
    await frames(4)

    // The editor must sit on the new node, not on the anchor it started on - the
    // bug showed as two "New node" boxes far apart from each other.
    expect(harness.count('New node')).toBe(1)
    expect(harness.editorOffsetFrom('New node')).toBe(0)
    expect(harness.input()?.style.left).toBe(`${harness.box('New node')!.left}px`)
  })

  it('follows the new node when it is added as a child', async () => {
    const harness = setup('- a\n- b\n')
    harness.select('a')
    harness.press('Tab')

    clock = 10_000
    await frames()

    harness.render('- a\n  - New node\n- b\n')
    harness.releaseWrite()
    await frames(4)

    expect(harness.count('New node')).toBe(1)
    expect(harness.editorOffsetFrom('New node')).toBe(0)
  })

  it('keeps following a render that lands after the window, through its animation', async () => {
    // Real clock: the point is that the follow window, which already expired,
    // has to be re-armed by the late render.
    vi.restoreAllMocks()
    const harness = setup('- a\n')
    harness.select('a')
    harness.press('Tab')

    // The render is slower than the follow window (300ms here).
    await new Promise(resolve => setTimeout(resolve, 400))

    // The node appears where its parent is and then slides to its own column,
    // one frame at a time - markmap animates entering nodes this way.
    harness.render('- a\n  - New node\n')
    harness.move('New node', 10)
    harness.releaseWrite()
    await frames(2)
    expect(parseFloat(harness.input()!.style.left)).toBeLessThan(100)

    harness.move('New node', 55)
    await frames(2)
    harness.move('New node', 100)
    await frames(3)

    // Without re-arming, the editor would be stuck at the first position it saw
    // - the second "New node" box in the screenshot, left of the real node.
    expect(harness.editorOffsetFrom('New node')).toBe(0)
    expect(harness.input()?.style.left).toBe('100px')
  })

  it('covers the new node\'s box and hides its own text once it is rendered', async () => {
    // markmap can draw a node wider than its source text (an ordered list renders
    // `43. New node`), so an input sized to the text alone leaves the node's tail
    // sticking out behind it: two boxes showing the same text twice.
    const harness = setup('- a\n')
    harness.select('a')
    harness.press('Tab')

    // Still over the anchor: size to the text, and hide the anchor's own label so
    // the input is the only copy of the text on screen.
    expect(harness.editorWidth()).toBeLessThan(50)
    expect((harness.nodeLabel('a') as HTMLElement).style.visibility).toBe('hidden')

    clock = 10_000
    await frames()
    harness.render('- a\n  - New node\n')
    harness.releaseWrite()
    await frames(4)

    // Over the real node: cover its whole box, exactly like a normal edit, and the
    // node's label stays hidden while the input stands in for it.
    expect(harness.editorWidth()).toBe(50)
    expect((harness.nodeLabel('New node') as HTMLElement).style.visibility).toBe('hidden')
    expect((harness.nodeLabel('a') as HTMLElement).style.visibility).toBe('')

    // Committing puts the node's own text back.
    harness.input()!.value = 'renamed'
    harness.input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await frames()
    expect((harness.nodeLabel('New node') as HTMLElement).style.visibility).toBe('')
  })

  it('keeps the text that was typed while the node was still being rendered', async () => {
    const harness = setup('- a\n')
    harness.select('a')
    harness.press('Enter')

    const input = harness.input()!
    input.value = 'typed early'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    clock = 10_000
    await frames()
    harness.render('- a\n- New node\n')
    harness.releaseWrite()
    await frames(4)

    expect(harness.input()).toBe(input)
    expect(harness.input()?.value).toBe('typed early')
    expect(harness.editorOffsetFrom('New node')).toBe(0)
  })
})
