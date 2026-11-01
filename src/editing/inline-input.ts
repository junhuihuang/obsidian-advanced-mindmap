import { editingActionForKey, type EditingAction } from './keymap'
import { nodeLabel } from 'src/rendering/node-widths'


export interface Rect {
  left: number
  top: number
  width: number
  height?: number
  /** Effective on-screen font size in CSS pixels (already scaled by the zoom). */
  fontSize?: number
  /**
   * Effective on-screen line height in CSS pixels (already scaled by the zoom).
   * The editor needs it to wrap the text at the node's own line breaks.
   */
  lineHeight?: number
  /** Font family the node is drawn with, so the editor wraps identically. */
  fontFamily?: string
  /** Font weight the node is drawn with (markmap's default is a light `300`). */
  fontWeight?: string
  /** Effective on-screen corner radius in CSS pixels (already scaled by the
   * zoom), so the editor matches the node's rounded box.
   */
  borderRadius?: number
  /**
   * How wide the node's text may get before markmap wraps it, in effective
   * on-screen pixels (already scaled by the zoom); `undefined` for "no limit".
   * The editor must wrap at the same width, or the box changes shape the moment
   * editing ends.
   */
  maxWidth?: number
  /**
   * True (the default) when this rect is the box the edited text will be
   * committed into, so the editor may cover it exactly.
   *
   * False while the rect only says where to start: a node that is still being
   * created is drawn on its anchor (its parent or previous sibling), and the
   * anchor's box says nothing about the text being typed.
   */
  trustWidth?: boolean
  /**
   * The element the editor stands in for - normally the node's
   * `.markmap-foreign`. Its own text is hidden while the input is open, so the
   * input is the only copy of the text on screen.
   *
   * The node can render wider or differently from the source text (an ordered
   * list prefixes `43. `, an image or emphasis markers add width), and while a
   * new node slides in the input can be a frame behind it; without hiding, both
   * copies are visible and the node's text sticks out from behind the input.
   */
  mask?: Element | null
}

export interface InlineInputHandlers {
  /** Called when the input loses focus (save only). */
  save: (text: string) => void
  /** Called on Enter (save and select). */
  commit: (text: string) => void
  /** Called on Tab (save and add a child). */
  addChild: (text: string) => void
  /** Called on Escape. */
  cancel: () => void
}

export interface InlineInputOptions {
  /**
   * Keep moving the input to follow `getRect()` for the node's animation.
   *
   * markmap animates node positions and does not wait for the transition, so a
   * freshly created node is initially drawn where its parent is. Following the
   * rect for the animation duration places the input on the node once it has
   * settled.
   */
  track?: boolean
  /** Duration (ms) of the node animation. The input follows for this long. */
  trackDuration?: number
  /**
   * Where to put the caret when editing starts: select the whole text
   * (default) or place the caret at the end (used by the `i` shortcut).
   */
  select?: 'all' | 'end'
  /**
   * Element whose children change whenever the mindmap is rendered. A node that
   * was just added only exists after the (async) re-render, and that render can
   * land after `trackDuration` - on a slow device, or behind a file write. The
   * editor then stayed on the node the new one was attached to, which looked
   * like two "New node" boxes far apart. Watching the mindmap moves it onto the
   * real node as soon as that node exists.
   */
  observe?: Element
}

/**
 * The element markmap draws a node's visible box in. Unlike the surrounding
 * `g.markmap-node`, whose bounding box also covers the connector line (left of
 * the text) and the fold circle (right of it), this element's rect matches the
 * visible box exactly. Falls back to `group` when markmap has not rendered the
 * content yet (for example on a brand new node).
 */
export function nodeContentElement(group: Element): Element {
  return group.querySelector('.markmap-foreign > div > div') ?? group
}

/** The node's effective on-screen text metrics, as needed by {@link openInlineInput}. */
export interface NodeFont {
  fontSize?: number
  lineHeight?: number
  fontFamily?: string
  fontWeight?: string
}

export interface NodeMetrics extends NodeFont {
  borderRadius: number
}

/** Reads all computed node metrics in one style lookup and one transform read. */
export function nodeMetrics(content: Element, group: Element): NodeMetrics {
  const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
    ? window.getComputedStyle(content)
    : undefined
  const scale = nodeScale(group)
  const pixels = (property: 'fontSize' | 'lineHeight' | 'borderRadius') => {
    const value = Number.parseFloat(style?.[property] ?? '')
    return Number.isFinite(value) ? value * scale : undefined
  }
  return {
    fontSize: pixels('fontSize'),
    lineHeight: pixels('lineHeight'),
    fontFamily: style?.fontFamily || undefined,
    fontWeight: style?.fontWeight || undefined,
    borderRadius: pixels('borderRadius') ?? 0,
  }
}

/**
 * The node's *effective* on-screen text metrics. markmap draws nodes inside a
 * scaled SVG transform, so the computed `font-size` and `line-height` stay at
 * their authored values while the text is actually drawn larger or smaller;
 * multiply both by the node's transform scale to get the size the user sees.
 *
 * The family and the weight matter just as much: the editor has to wrap the text
 * at the *same* points as the node. markmap wraps at `maxWidth`, so a node whose
 * text spans several lines would otherwise be edited as one clipped line.
 */
export function nodeFont(content: Element, group: Element): NodeFont {
  const metrics = nodeMetrics(content, group)
  return {
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    fontFamily: metrics.fontFamily,
    fontWeight: metrics.fontWeight,
  }
}

/**
 * The node's *effective* on-screen corner radius, for the same reason as
 * `nodeFont`: the authored `--radius-s` is in content pixels and the SVG
 * zoom scales it. Without this the inline editor keeps its tiny CSS radius
 * while the node grows, so at high zoom its corners look like right angles.
 */
export function nodeBorderRadius(content: Element, group: Element): number {
  return nodeMetrics(content, group).borderRadius
}

/**
 * markmap's "no wrapping" default. It writes `--markmap-max-width` on the svg
 * only when a `maxWidth` is configured, and the stylesheet falls back to
 * `9999px`, which no node ever reaches - so anything in that range means "the
 * node is never wrapped".
 */
const NO_WRAP_LIMIT = 9000

/**
 * The node's wrap width, in effective on-screen pixels, or `undefined` when the
 * node is never wrapped. markmap wraps node text at `maxWidth`, and it publishes
 * the value it used as `--markmap-max-width` on the svg - reading it back means
 * the editor honours per-file settings without duplicating the option plumbing.
 */
export function nodeMaxWidth(group: Element): number | undefined {
  const svg = group.closest<SVGSVGElement>('svg.markmap') ?? group.closest<SVGSVGElement>('svg')
  if (!svg) return undefined

  // A node resized with the mouse has its own fixed width, which overrides the
  // global `maxWidth` the same way the inline style overrides markmap's CSS.
  const fixed = Number.parseFloat(nodeLabel(group)?.style.width ?? '')
  if (Number.isFinite(fixed) && fixed > 0) return fixed * nodeScale(group)

  // Inline first (what markmap set), the stylesheet's default second.
  const raw = svg.style?.getPropertyValue('--markmap-max-width')?.trim()
    || (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(svg).getPropertyValue('--markmap-max-width').trim()
      : '')
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0 || value >= NO_WRAP_LIMIT) return undefined
  return value * nodeScale(group)
}

/**
 * The narrowest box the editor will use. Only a guard against a degenerate
 * zero-width box (empty text): the box otherwise matches the node exactly, so a
 * one-character node gets a one-character box, just like the node itself.
 */
export const MIN_EDITOR_WIDTH = 8

/**
 * The editor's width for a single-line text `lineWidth` wide.
 *
 * The box has to be the box the node will have once the text is committed:
 * markmap sizes a node to its text, capped at `maxWidth`. Taking the *node's
 * current* width instead (as the first version did) freezes the box at the old
 * text's size, so typing a long sentence wrapped it inside a small box and the
 * node "jumped" back to one wide line after committing.
 */
export function editorWidth(lineWidth: number, maxWidth?: number): number {
  // +1: guard against the textarea's own layout rounding down a fraction where
  // the measurement rounded up, which would wrap the last glyph onto its own
  // line.
  const hasLimit = maxWidth !== undefined && maxWidth > 0
  const wanted = Math.ceil(lineWidth) + 1
  const capped = hasLimit ? Math.min(wanted, maxWidth) : wanted
  // A limit narrower than the minimum wins: the editor must never be wider than
  // the node it is standing in for.
  return Math.max(capped, Math.min(MIN_EDITOR_WIDTH, hasLimit ? maxWidth : MIN_EDITOR_WIDTH))
}

/** The scale factor markmap currently applies to a node via its SVG transform. */
function nodeScale(group: Element): number {
  const ctm = (group as SVGGraphicsElement).getScreenCTM?.()
  if (ctm) {
    const measured = Math.hypot(ctm.a, ctm.b)
    if (Number.isFinite(measured) && measured > 0) return measured
  }
  return 1
}

/**
 * Measures how wide a text is on a single line, in the editor's own font.
 *
 * A hidden, non-wrapping mirror is used instead of the textarea itself: reading
 * `scrollWidth` off the real input means flipping `wrap` off, forcing a layout
 * and restoring it on every keystroke, which makes the caret jump.
 */
function createLineMeasurer(reference: HTMLTextAreaElement) {
  const mirror = createDiv('advmm-node-measure')
  document.body.appendChild(mirror)

  // `position()` also runs once per animation frame while a new node settles,
  // and the text does not change then: reuse the last measurement instead of
  // forcing another layout every frame.
  let measuredText: string | null = null
  let measuredWidth = 0

  return {
    measure(text: string): number {
      if (text === measuredText) return measuredWidth
      mirror.setCssStyles({
        fontSize: reference.style.fontSize,
        lineHeight: reference.style.lineHeight,
        fontFamily: reference.style.fontFamily,
        fontWeight: reference.style.fontWeight,
      })
      mirror.textContent = text
      measuredText = text
      measuredWidth = mirror.getBoundingClientRect().width
      return measuredWidth
    },
    remove() {
      mirror.remove()
    },
  }
}

/** An element whose inline `visibility` the editor hides while editing. */
interface MaskedNode {
  element: StyledElement
  visibility: string
}

/** An element that carries inline styles (HTML or SVG alike). */
type StyledElement = HTMLElement | SVGElement

export function openInlineInput(
  value: string,
  getRect: () => Rect,
  handlers: InlineInputHandlers,
  options: InlineInputOptions = {},
): HTMLTextAreaElement {
  // A `<textarea>`, not an `<input>`: markmap wraps a node's text at `maxWidth`,
  // and a single-line input cannot show that — it clips (or scrolls away) every
  // character that does not fit the node's box, so editing a sentence showed
  // only part of it until the caret was moved or editing was left.
  const input = createEl('textarea', { cls: 'advmm-node-editor' })
  input.value = value
  input.rows = 1
  // Inline styles, not classes: Obsidian's own `textarea` styles add padding
  // and a border, which would leave the editor a narrower content box than the
  // node and wrap the text earlier. The rect describes the node's border box,
  // so the input is sized the same way. Obsidian themes may add CSS transitions
  // on textarea; position tracking (rAF every frame during animation) must
  // never be interpolated.
  input.setCssStyles({
    position: 'fixed',
    boxSizing: 'border-box',
    padding: '0px',
    border: 'none',
    transition: 'none',
  })

  // The node whose own text the editor replaces. See `Rect.mask`.
  let masked: MaskedNode | null = null
  const maskNode = (element: Element | null | undefined) => {
    const next: StyledElement | null = element instanceof HTMLElement || element instanceof SVGElement ? element : null
    if ((masked?.element ?? null) === next) return
    if (masked) {
      masked.element.setCssStyles({ visibility: masked.visibility })
      masked = null
    }
    if (next) {
      masked = { element: next, visibility: next.style.visibility }
      next.setCssStyles({ visibility: 'hidden' })
    }
  }

  // Whether the current rect is the node's own box (see `Rect.trustWidth`).
  let coversNode: boolean | undefined

  const position = (fast?: boolean): Rect => {
    const rect = getRect()
    // Not part of the early `fast` return: a new node replaces its anchor as the
    // node the input stands in for, and the anchor's text must come back the
    // moment the input is no longer over it.
    maskNode(rect.mask)
    input.setCssStyles({ left: `${rect.left}px`, top: `${rect.top}px` })
    const trustWidth = rect.trustWidth ?? true
    // Snapping from the anchor onto the real node changes how wide the box has
    // to be. Measure right away instead of waiting for the next idle pass, or
    // the node's tail shows from behind the input for that long.
    const movedOntoNode = trustWidth !== coversNode
    coversNode = trustWidth
    // When tracking a moving node during animation (fast mode) only update
    // the position; skip the expensive text-measurement and scrollHeight
    // reads that would force synchronous reflows during markmap's GPU
    // transition.
    if (fast && !movedOntoNode) return rect
    input.setCssStyles({
      fontSize: rect.fontSize !== undefined ? `${rect.fontSize}px` : '',
      lineHeight: rect.lineHeight !== undefined ? `${rect.lineHeight}px` : '',
      fontFamily: rect.fontFamily ?? '',
      fontWeight: rect.fontWeight ?? '',
    })
    // When the node has no rounded corners (e.g., a fresh node whose anchor is
    // not selected), the computed border-radius is 0; let the CSS var supply
    // the theme's default roundness instead of overriding it with sharp 0px.
    const radius = rect.borderRadius ?? 0
    input.setCssStyles({ borderRadius: radius > 0 ? `${radius}px` : '' })
    // Before the user types, cover the node's own box: markmap can draw the node
    // wider than its source text (an ordered list renders `43. New node`), and a
    // box sized to the text alone leaves the node's tail sticking out from
    // behind the input. A rect that only marks where to start (a node that is
    // still being created) is trusted for the text width only.
    const textWidth = measurer.measure(input.value)
    const wanted = editorWidth(textWidth, rect.maxWidth)
    const cover = trustWidth && !typed
    input.setCssStyles({
      width: `${cover
        ? Math.max(rect.width, wanted, MIN_EDITOR_WIDTH)
        : Math.max(wanted, MIN_EDITOR_WIDTH)}px`,
      // Height: always content-based. The rendered box may include nodeMinHeight
      // padding or belong to a different anchor node; neither should inflate
      // the editor.
      height: 'auto',
    })
    const height = Math.max(rect.lineHeight ?? 0, input.scrollHeight)
    input.setCssStyles({ height: height > 0 ? `${height}px` : '' })
    return rect
  }

  const measurer = createLineMeasurer(input)

  // Append first: `scrollHeight` is only measurable once laid out.
  document.body.appendChild(input)
  let typed = false
  position()
  input.focus()
  if (options.select === 'end') {
    const end = input.value.length
    input.setSelectionRange(end, end)
  }
  else {
    input.select()
  }

  const stopTracking = options.track || options.observe
    ? trackPosition(input, position, options.track ? (options.trackDuration ?? 0) : 0, options.observe)
    : undefined

  let finished = false
  const finish = () => {
    if (finished) return false
    finished = true
    stopTracking?.()
    input.remove()
    measurer.remove()
    // The node's own text replaces the input again.
    maskNode(null)
    return true
  }

  // One node is one markdown line: a newline can only come from a paste (Enter
  // is the commit key), and it must not break the node into two lines in the
  // file.
  const readText = () => input.value.replace(/[\r\n]+/g, ' ')

  const run = (action: EditingAction, text: string) => {
    if (action === 'cancel') handlers.cancel()
    else if (action === 'addChild') handlers.addChild(text)
    else handlers.commit(text)
  }

  input.addEventListener('input', () => {
    typed = true
    position()
  })

  input.addEventListener('keydown', event => {
    const action = editingActionForKey(event.key)
    if (!action) return

    event.preventDefault()
    const text = readText()
    if (finish()) run(action, text)
  })

  input.addEventListener('blur', () => {
    if (finish()) handlers.save(readText())
  })

  return input
}

/**
 * Keeps the editor on its node.
 *
 * A new node is drawn where its parent is and only then slides to its own
 * position, so the editor has to follow for the whole animation - not for a
 * fixed time. Two things keep that honest:
 *
 * - every re-render of the mindmap *re-arms* the window (`observe`), because the
 *   render can land long after the editor opened (file write, big file, slow
 *   device);
 * - while the node is still moving the window keeps being extended, and once
 *   everything is still the position is re-checked a few times per second until
 *   the editor closes. That way a missed event or a layout error can only delay
 *   the correction, never leave the editor stranded somewhere else.
 */
function trackPosition(
  input: HTMLTextAreaElement,
  position: (fast?: boolean) => Rect,
  duration: number,
  observe?: Element,
): () => void {
  // markmap starts the transition on the next frame, so add a small buffer.
  const trackWindow = duration + 300
  /** How often the (otherwise idle) position is re-checked. */
  const idle = 200
  let end = performance.now() + trackWindow
  let nextIdle = 0
  let frame = 0
  let running = false
  let lastLeft = Number.NaN
  let lastTop = Number.NaN

  const tick = () => {
    frame = 0
    if (!input.isConnected) {
      running = false
      return
    }
    const now = performance.now()
    const following = now < end
    if (following || now >= nextIdle) {
      nextIdle = now + idle
      let rect: Rect | undefined
      try {
        // During the active animation window only track left/top (cheap);
        // on idle re-checks do the full measurement to correct any drift.
        rect = position(following)
      }
      catch {
        // A transient layout error (a node replaced mid-measurement) must not
        // end the follow loop: the next tick tries again.
      }
      if (rect) {
        const moved = rect.left !== lastLeft || rect.top !== lastTop
        lastLeft = rect.left
        lastTop = rect.top
        // Still moving (an animation, a pan, a zoom): keep following. A second
        // render can restart the slide without any structural change, so this
        // cannot be a fixed deadline.
        if (moved) end = now + trackWindow
      }
    }
    frame = window.requestAnimationFrame(tick)
  }

  const arm = () => {
    end = performance.now() + trackWindow
    if (running || !input.isConnected) return
    running = true
    frame = window.requestAnimationFrame(tick)
  }

  const observer = observe ? new MutationObserver(arm) : undefined
  observer?.observe(observe!, { childList: true, subtree: true })
  arm()

  return () => {
    observer?.disconnect()
    if (frame) window.cancelAnimationFrame(frame)
    running = false
  }
}
