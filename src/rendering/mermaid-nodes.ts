import { Component, MarkdownRenderer } from 'obsidian'

import { getApp } from 'src/core/app'


/** Fenced language whose blocks are drawn as a diagram instead of as source. */
export const MERMAID_LANGUAGE = 'mermaid'

/** The element that stands in for one rendered fence. */
export const MERMAID_CLASS = 'advmm-mermaid'
/** Our own copy of the fence, shown only when the diagram could not be drawn. */
export const MERMAID_SOURCE_CLASS = 'advmm-mermaid-source'
/** The element Obsidian renders the diagram into. */
export const MERMAID_DIAGRAM_CLASS = 'advmm-mermaid-diagram'

/** `data-` state of a wrapper: `pending` | `ready` | `failed` (see `styles.css`). */
const STATE_ATTRIBUTE = 'data-mermaid-state'

/** How long Obsidian may take before the source is shown instead of the diagram. */
const DEFAULT_TIMEOUT = 2000

export interface MermaidNodesOptions {
  /**
   * The note a diagram belongs to. Obsidian resolves relative links inside the
   * diagram against it.
   */
  getSourcePath?: () => string | undefined
  /**
   * Called once a diagram is in the DOM: its box is bigger than the fence it
   * replaced, so the canvas has to re-measure before the node fits its content.
   */
  onRendered?: () => void
  /** Milliseconds to wait for Obsidian's renderer. `0` never shows the source. */
  timeout?: number
}

export interface MermaidNodes {
  /**
   * Draws every fence that has no diagram yet. Idempotent, and already wired to
   * a `MutationObserver` on the canvas, so this is only needed to render
   * synchronously (tests) or after content that was written without a mutation.
   */
  render: () => void
  /**
   * Resolves once no fence is being drawn any more. A caller that fits the view
   * has to await this first: a diagram is much bigger than the fence it
   * replaces, and framing the canvas before it is drawn crops it.
   */
  whenIdle: () => Promise<void>
  destroy: () => void
}

/** A fence Obsidian has been asked to draw but has not answered for yet. */
interface Pending {
  wrapper: HTMLElement
  canvas: HTMLElement
  timer: number
}

/**
 * Draws ```` ```mermaid ```` code blocks as diagrams.
 *
 * markmap renders every code block as its source text, so a node holding a
 * Mermaid diagram shows the fence. Rather than parsing Mermaid ourselves (theme
 * colours, fonts, every diagram type, error messages), each fence is handed to
 * Obsidian's own Markdown renderer, which replaces it with the diagram — the
 * same output the reading view produces. The node keeps its source path and its
 * text, so selection, folding and editing still hit the right line.
 *
 * The fence is only rendered when it appears: markmap keeps the DOM of an
 * unchanged node across `renderData()`, so an existing diagram is never
 * re-parsed. A node whose text changed gets a new element (markmap keys nodes by
 * content) and therefore a new diagram.
 */
export function createMermaidNodes(
  svg: SVGSVGElement,
  { getSourcePath, onRendered, timeout = DEFAULT_TIMEOUT }: MermaidNodesOptions = {},
): MermaidNodes {
  const component = new Component()
  component.load()

  const pending = new Map<HTMLElement, Pending>()
  /** Fences currently being handed to Obsidian's renderer. */
  const inflight = new Set<Promise<void>>()
  let destroyed = false

  const observer = typeof MutationObserver === 'undefined'
    ? undefined
    : new MutationObserver(() => render())
  observer?.observe(svg, { childList: true, subtree: true })

  function render(): void {
    if (destroyed) return

    for (const entry of Array.from(pending.values())) {
      // The node was re-rendered or folded away: nothing left to wait for.
      // (`contains`, not `isConnected`: a canvas can be rendered while its view
      // is still detached, and then it is still the node's own content.)
      if (!svg.contains(entry.wrapper)) forget(entry)
      else if (isDrawn(entry.canvas)) settle(entry)
    }

    for (const code of unrenderedFences(svg)) {
      const task: Promise<void> = takeOver(code).finally(() => inflight.delete(task))
      inflight.add(task)
    }
  }

  async function whenIdle(): Promise<void> {
    // A draw can add another one (a node's content is written after its
    // parent's), so re-check until nothing is left.
    while (inflight.size > 0) await Promise.all(Array.from(inflight))
  }

  function forget(entry: Pending): void {
    window.clearTimeout(entry.timer)
    pending.delete(entry.canvas)
  }

  function settle(entry: Pending): void {
    // Already settled and drawn (the observer can settle a diagram before the
    // render promise resolves).
    if (!pending.has(entry.canvas)) {
      if (isDrawn(entry.canvas)) forget(entry)
      return
    }

    const drawn = isDrawn(entry.canvas)
    window.clearTimeout(entry.timer)
    entry.timer = 0
    entry.wrapper.setAttribute(STATE_ATTRIBUTE, drawn ? 'ready' : 'failed')

    // Never leave two copies of the source on screen. Obsidian replaces the
    // fence with the diagram, but when the node was not shown yet it *keeps*
    // the fence and defers the mount — that fence is then the source the user
    // sees, and it has to stay visible: the deferred mount re-checks
    // `isShown()` (`offsetParent`) and would be postponed forever, so only our
    // own copy is dropped in that case.
    const leftover = fenceIn(entry.canvas)
    if (drawn) leftover?.remove()
    else if (leftover) entry.wrapper.querySelector(`.${MERMAID_SOURCE_CLASS}`)?.remove()

    // A deferred mount can still land: keep `entry` alive so this runs again
    // (and re-measures the node) when the diagram shows up.
    if (!drawn) return
    pending.delete(entry.canvas)
    onRendered?.()
  }

  /** The fence Obsidian kept in a diagram's container, if it is still there. */
  function fenceIn(canvas: HTMLElement): HTMLElement | null {
    const code = Array.from(canvas.querySelectorAll('code'))
      .find(element => element.classList.contains(`language-${MERMAID_LANGUAGE}`))
    return (code?.closest('pre') as HTMLElement | null) ?? null
  }

  async function takeOver(code: HTMLElement): Promise<void> {
    const pre = code.parentElement
    const text = code.textContent ?? ''
    if (!pre || !text.trim()) return

    // Replace the source fence before rendering, so a scan that runs while the
    // diagram is being drawn cannot start a second one for the same node.
    const wrapper = createDiv({ cls: MERMAID_CLASS })
    wrapper.setAttribute(STATE_ATTRIBUTE, 'pending')

    const source = pre.cloneNode(true) as HTMLElement
    source.removeAttribute('data-lines')
    source.classList.add(MERMAID_SOURCE_CLASS)

    const canvas = createDiv({ cls: MERMAID_DIAGRAM_CLASS })

    wrapper.append(source, canvas)
    pre.replaceWith(wrapper)

    const entry: Pending = { wrapper, canvas, timer: 0 }
    pending.set(canvas, entry)
    if (timeout > 0) {
      entry.timer = window.setTimeout(() => {
        entry.timer = 0
        if (!destroyed) settle(entry)
      }, timeout)
    }

    try {
      await MarkdownRenderer.render(
        getApp(),
        fenced(text),
        canvas,
        getSourcePath?.() ?? '',
        component,
      )
    } catch {
      // Obsidian's renderer could not even parse the block; keep the source.
      if (!destroyed) wrapper.setAttribute(STATE_ATTRIBUTE, 'failed')
      return
    }

    // Usually the diagram is already there; when Mermaid is still loading or
    // the block was parsed asynchronously, the observer settles it later.
    if (!destroyed && isDrawn(canvas)) settle(entry)
  }

  return {
    render,
    whenIdle,
    destroy() {
      destroyed = true
      observer?.disconnect()
      for (const entry of pending.values()) window.clearTimeout(entry.timer)
      pending.clear()
      component.unload()
    },
  }
}

/** Every ```` ```mermaid ```` fence markmap rendered that is not drawn yet. */
function unrenderedFences(svg: SVGSVGElement): HTMLElement[] {
  const selector = `pre > code.language-${MERMAID_LANGUAGE}`
  return Array.from(svg.querySelectorAll<HTMLElement>(selector))
    // A diagram's own output (and the copy of the fence we keep beside it) lives
    // inside a wrapper, so it is never a candidate again.
    .filter(code => !code.closest(`.${MERMAID_CLASS}`))
}

/** True once Obsidian put the diagram into `canvas` (an error box counts too). */
function isDrawn(canvas: HTMLElement): boolean {
  return canvas.querySelector('.mermaid') !== null
}

/** The block as Obsidian's renderer wants it: a fenced code block again. */
function fenced(text: string): string {
  const body = text.replace(/\n+$/, '')
  return '```' + MERMAID_LANGUAGE + '\n' + body + '\n```'
}
