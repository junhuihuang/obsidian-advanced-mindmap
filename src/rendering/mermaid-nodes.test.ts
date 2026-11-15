// @vitest-environment jsdom
import { MarkdownRenderer } from 'obsidian'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMermaidNodes,
  MERMAID_CLASS,
  MERMAID_DIAGRAM_CLASS,
  MERMAID_SOURCE_CLASS,
} from './mermaid-nodes'

vi.mock('src/core/app', () => ({ getApp: () => ({}) }))

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The DOM markmap draws for a node whose content is one fenced block. */
function nodeWithFence(code: string): { svg: SVGSVGElement; label: HTMLElement } {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'markmap-node')
  const foreign = document.createElementNS(SVG_NS, 'foreignObject')
  foreign.setAttribute('class', 'markmap-foreign')
  const label = document.createElement('div')
  label.append(fence(code))
  foreign.append(label)
  group.append(foreign)
  svg.append(group)
  return { svg, label }
}

function fence(code: string): HTMLElement {
  const pre = document.createElement('pre')
  pre.setAttribute('data-lines', '2,6')
  const element = document.createElement('code')
  element.className = 'language-mermaid'
  element.textContent = code
  pre.append(element)
  return pre
}

/** What Obsidian's renderer leaves behind: a `div.mermaid` holding the diagram. */
function drawDiagram(container: HTMLElement): void {
  const drawn = document.createElement('div')
  drawn.className = 'mermaid'
  const diagram = document.createElementNS(SVG_NS, 'svg')
  diagram.setAttribute('width', '400')
  diagram.setAttribute('height', '300')
  drawn.append(diagram)
  container.append(drawn)
}

function wrapper(svg: SVGSVGElement): HTMLElement | null {
  return svg.querySelector<HTMLElement>(`.${MERMAID_CLASS}`)
}

function state(svg: SVGSVGElement): string | null {
  return wrapper(svg)?.getAttribute('data-mermaid-state') ?? null
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('condition was never met')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createMermaidNodes', () => {
  it("draws a fence with Obsidian's own renderer", async () => {
    const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app, _markdown, el) => { drawDiagram(el as HTMLElement) })

    const { svg, label } = nodeWithFence('graph TD\n  A-->B')
    const onRendered = vi.fn()
    createMermaidNodes(svg, { getSourcePath: () => 'note.md', onRendered, timeout: 0 }).render()

    await waitFor(() => state(svg) === 'ready')

    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0][1]).toBe('```mermaid\ngraph TD\n  A-->B\n```')
    expect(render.mock.calls[0][3]).toBe('note.md')
    expect(onRendered).toHaveBeenCalledTimes(1)

    // The fence is gone from the node, the diagram is what markmap measures.
    expect(label.firstElementChild!.className).toBe(MERMAID_CLASS)
    expect(wrapper(svg)!.querySelector(`.${MERMAID_DIAGRAM_CLASS} .mermaid svg`)).not.toBeNull()
  })

  it('keeps the source next to the diagram for the failure case', async () => {
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
      drawDiagram(el as HTMLElement)
    })

    const { svg } = nodeWithFence('graph TD\n  A-->B')
    createMermaidNodes(svg, { timeout: 0 }).render()
    await waitFor(() => state(svg) === 'ready')

    const source = wrapper(svg)!.querySelector<HTMLElement>(`.${MERMAID_SOURCE_CLASS}`)
    expect(source).not.toBeNull()
    expect(source!.textContent).toBe('graph TD\n  A-->B')
    // `styles.css` shows it only in the `failed` state.
    expect(source!.hasAttribute('data-lines')).toBe(false)
  })

  it('shows the source when Obsidian draws nothing', async () => {
    vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()

    const { svg } = nodeWithFence('graph TD\n  A-->B')
    const onRendered = vi.fn()
    createMermaidNodes(svg, { onRendered, timeout: 5 }).render()

    await waitFor(() => state(svg) === 'failed')
    expect(onRendered).not.toHaveBeenCalled()
  })

  it("leaves Obsidian's own fence as the source when it kept the block", async () => {
    // A node that is not shown yet (an inactive tab, a hidden split) makes
    // Obsidian keep the fence and defer the mount to `onNodeInserted`. That
    // deferred mount re-checks `isShown()` (`offsetParent`), so the fence must
    // stay visible: hiding it would postpone the diagram for good.
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.className = 'language-mermaid'
      code.textContent = 'graph TD'
      pre.append(code)
      ;(el as HTMLElement).append(pre)
    })

    const { svg } = nodeWithFence('graph TD')
    createMermaidNodes(svg, { timeout: 5 }).render()
    await waitFor(() => state(svg) === 'failed')

    const kept = wrapper(svg)!.querySelector<HTMLElement>(`.${MERMAID_DIAGRAM_CLASS} pre`)
    expect(kept).not.toBeNull()
    expect(kept!.parentElement?.className).toBe(MERMAID_DIAGRAM_CLASS)
    // The fence is the source on screen, so ours would be a second copy.
    expect(wrapper(svg)!.querySelector(`.${MERMAID_SOURCE_CLASS}`)).toBeNull()
  })

  it('switches to the diagram when it arrives after the timeout', async () => {
    const render = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()

    const { svg } = nodeWithFence('graph TD\n  A-->B')
    const onRendered = vi.fn()
    createMermaidNodes(svg, { onRendered, timeout: 5 }).render()
    await waitFor(() => state(svg) === 'failed')

    // Mermaid finished loading late (Obsidian's renderer is async then).
    drawDiagram(wrapper(svg)!.querySelector<HTMLElement>(`.${MERMAID_DIAGRAM_CLASS}`)!)

    await waitFor(() => state(svg) === 'ready')
    expect(onRendered).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('renders each fence once, even when the canvas re-renders', async () => {
    const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app, _markdown, el) => { drawDiagram(el as HTMLElement) })

    const { svg } = nodeWithFence('graph TD\n  A-->B')
    const nodes = createMermaidNodes(svg, { timeout: 0 })
    nodes.render()
    await waitFor(() => state(svg) === 'ready')

    nodes.render()
    nodes.render()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(render).toHaveBeenCalledTimes(1)
  })

  it('drops the fence Obsidian kept beside a deferred diagram', async () => {
    // When the block is not shown yet, Obsidian appends the diagram and leaves
    // the fence in place (see `Qle` in app.js). Both must not stay on screen.
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
      const source = document.createElement('pre')
      const code = document.createElement('code')
      code.className = 'language-mermaid'
      code.textContent = 'graph TD'
      source.append(code)
      ;(el as HTMLElement).append(source)
      drawDiagram(el as HTMLElement)
    })

    const { svg } = nodeWithFence('graph TD')
    createMermaidNodes(svg, { timeout: 0 }).render()

    await waitFor(() => state(svg) === 'ready')
    expect(wrapper(svg)!.querySelector('.advmm-mermaid-diagram pre')).toBeNull()
    expect(wrapper(svg)!.querySelector('.mermaid svg')).not.toBeNull()
  })

  it('reports when nothing is being drawn any more', async () => {
    let draw: (el: HTMLElement) => void = () => {}
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      (_app, _markdown, el) => new Promise<void>(resolve => {
        draw = target => { drawDiagram(target); resolve() }
      }))

    const { svg } = nodeWithFence('graph TD\n  A-->B')
    const nodes = createMermaidNodes(svg, { timeout: 0 })
    nodes.render()

    let idle = false
    void nodes.whenIdle().then(() => { idle = true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(idle).toBe(false)

    draw(svg.querySelector<HTMLElement>(`.${MERMAID_DIAGRAM_CLASS}`)!)
    await waitFor(() => idle)
    expect(idle).toBe(true)
  })

  it('stops after destroy', async () => {
    const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app, _markdown, el) => { drawDiagram(el as HTMLElement) })

    const { svg, label } = nodeWithFence('graph TD\n  A-->B')
    const nodes = createMermaidNodes(svg, { timeout: 0 })
    nodes.destroy()
    label.append(fence('graph LR\n  C-->D'))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(render).not.toHaveBeenCalled()
  })
})
