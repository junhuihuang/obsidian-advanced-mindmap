import type { IPureNode } from 'markmap-common'
import { Menu, Notice, Platform, setIcon } from 'obsidian'

import { strings } from 'src/translation'
import { editorActions, type ActionState, type EditorCommand } from './actions'
import { clipboardCommandForEvent, directionForKey, isModifierKey, nodeActionForKey, resizeCommandForEvent, resolveFoldSequence, zoomCommandForEvent, FOLD_PREFIX, GOTO_PREFIX, type ClipboardCommand, type Direction, type FoldAction, type ResizeAction, type ZoomAction } from './keymap'
import { resolveDropTarget, type DropBox, type DropTarget } from './drop-target'
import { foldCommandPlan, revealNextLevelPlan, type FoldLevelAction, type FoldNode, type FoldPlan } from './fold'
import { focusPaths, siblingPaths } from './focus'
import { HELP_SECTIONS } from './help'
import { FOLD_HINTS } from './fold-hints'
import { nodeContentElement, nodeMaxWidth, nodeMetrics, openInlineInput } from './inline-input'
import { findNodeInDirection, isDescendantPath, nearestPath, type NodePosition } from './navigation'
import { getSourcePath } from './source-paths'
import { collectSearchNodes, findMatches, isQueryEmpty, stepIndex } from './search'
import { applyEdit, flattenPaths, getNodeAtPath, moveNode, moveNodes, parseSource, pathAtLine, pathKey, pathRange, removeNodes as removeSourceNodes, rootChildTarget, samePath, type EditOperation, type SourceNode } from './source-tree'
import { isDoubleTap, movedBeyondThreshold, tapAction, LONG_PRESS_MS, type TapPoint } from './touch'
import { applyNodeWidths, clampNodeWidth, nodeLabel, nodeWidth, nodeWidthKey } from 'src/rendering/node-widths'
import type { NodeWidths } from 'src/settings/filesystem'
import type { TreeChangeListener, TreeEdit } from 'src/rendering/tree-updater'
import { holdZoomFactor, ZOOM_STEP, type ZoomAnchor, type ZoomRect } from 'src/rendering/zoom'
import { clearNativeSelection, DRAG_THRESHOLD_SQUARED, findAnyNodeGroup, findNodeGroup, isInteractiveTarget, isTextInput, sameDropTarget } from './editor-helpers'


/** Pixels from a node's right edge where a press resizes it instead of moving it. */
const RESIZE_EDGE_ZONE = 6
/** Movement (px) before a press on the edge becomes a resize rather than a click. */
const RESIZE_MIN_DELTA = 3
/** Content pixels added/removed by one `Ctrl+Shift` + `+` / `-` key press. */
const KEY_RESIZE_STEP = 24

export interface NodeEditorOptions {
  svg: SVGSVGElement
  /** Returns the already parsed source tree used by the current render. */
  getSourceRoots?: () => SourceNode[]
  /** Returns the latest markdown for the rendered mindmap. */
  getMarkdown: () => string
  setMarkdown: (markdown: string) => void | Promise<void>
  /**
   * Per-node widths for the current note. They are stored in the plugin's data
   * file rather than the markdown, so resizing never edits the note.
   */
  getNodeWidths?: () => NodeWidths
  /** Persists one node's width (`null` clears it); returns whether it changed. */
  setNodeWidth?: (key: string, width: number | null) => boolean
  /** Exact creation/rename operations so the renderer can preserve node identity. */
  onSourceChange?: TreeChangeListener
  /** Duration (ms) of the markmap position animation. */
  getAnimationDuration?: () => number
  /** Pans the mindmap so the given node is visible. */
  ensureVisible?: (node: IPureNode) => void
  /**
   * Pans the mindmap so the selected node's subtree sits centered, matching the
   * keyboard zoom placement (`Shift+M`).
   */
  centerNode?: (node: IPureNode) => void | Promise<void>
  /**
   * Scales the view by `factor`, moving `anchor` to the canvas center.
   * `keepVisible` is the selected node's box; when given, the view is nudged so
   * that node can never leave the viewport however far the user zooms in.
   */
  zoomBy?: (factor: number, anchor?: ZoomAnchor, keepVisible?: ZoomRect) => void
  /**
   * Content-space center of a node's whole subtree (not just the node), used
   * as the zoom anchor so the node lands left of center and its children fill
   * the rest of the canvas.
   */
  getZoomAnchor?: (node: IPureNode) => ZoomAnchor | undefined
  /**
   * Content-space box of a node, used to keep the selected node on screen while
   * zooming or centering.
   */
  getZoomRect?: (node: IPureNode) => ZoomRect | undefined
  /**
   * Content-space center of the whole mindmap, used as the zoom anchor when
   * nothing is selected so the content zooms about its own middle.
   */
  getContentZoomAnchor?: () => ZoomAnchor | undefined
  /** Hides/reveals a node's children. */
  toggleFold?: (node: IPureNode) => void | Promise<void>
  /** Reveals exactly one level of a node's subtree (used by `l` on a folded node). */
  revealChildren?: (node: IPureNode) => void | Promise<void>
  /** Reveals every descendant of a node (used by `zO`). */
  revealAllChildren?: (node: IPureNode) => void | Promise<void>
  /** Root of the rendered markmap tree, for the whole-tree fold commands. */
  getFoldRoot?: () => FoldNode | undefined
  /** Applies the fold changes computed by the whole-tree commands. */
  applyFoldPlan?: (plan: FoldPlan) => void | Promise<void>
  /** Fits the entire mindmap into the viewport, like the toolbar "Fit window size" button. */
  fitContent?: () => Promise<void>
  /**
   * Live-resize support: while a node is dragged by its right edge, layout must
   * follow the pointer. These let the editor run markmap's layout without its
   * 500 ms position transitions, and stop it again on release.
   */
  beginLiveLayout?: () => void
  endLiveLayout?: () => void
  /** Re-runs markmap's layout (`renderData`) immediately. */
  relayout?: () => void | Promise<void>
  /**
   * Opens the markdown source file in a split and places the cursor at the
   * given line (1-based). Used by the `gd` (go-to-definition) shortcut.
   */
  goToSourceLine?: (line: number) => void
}

export interface NodeEditorHandle {
  /** Removes all listeners owned by the editor. */
  destroy: () => void
  /** Focuses the editor so keyboard navigation/editing works. */
  focus: () => void
}

/**
 * Adds outliner-style editing to a rendered markmap:
 *
 *  - click a node to select it (highlighted), shift-click to select a range
 *  - left-drag empty canvas to rubber-band select nodes, right-drag to pan
 *  - hold `Shift` while navigating to extend the selection from its anchor
 *  - drag a node onto another to move it there (same as cut & paste)
 *  - double-click a node to rename it
 *  - on touch devices (mobile) the same editing works through gestures: tap to
 *    select, double-tap to rename, hold (long press) a node to drag it, hold
 *    empty canvas to rubber-band select, and a floating action bar offers
 *    add/rename/delete/cut/paste/fold/undo/redo without a keyboard
 *  - with nothing selected, a navigation key first moves the cursor to a "home"
 *    node (the last selection, or the node nearest the viewport center)
 *  - `→`/`l` walks into a folded node by expanding it one level and selecting
 *    its first child
 *  - `Ctrl+X` marks the selected nodes (they turn translucent) and `Ctrl+V`
 *    moves them to become the last children of the selected target
 *  - dragging a node has the same effect as cut & paste
 *  - `Ctrl+Z` undoes and `Ctrl+U` redoes
 *  - while selected: `i` edits the node (caret at the end), `Tab` adds a
 *    child, `Enter` adds a sibling, `Backspace`/`Delete` removes the selected
 *    node(s), and `Escape` clears the selection
 *  - `zc` folds the selected node, or with nothing selected the whole tree
 *    one level at a time from the deepest level
 *  - `zo` unfolds one level of the selected node, or of the whole tree
 *  - `zO` unfolds every descendant of the selected node, or of the whole tree
 *  - `za` toggles between fully collapsed and fully expanded
 *  - `/` searches the whole tree: every matching node is highlighted, the
 *    current match more strongly. Typing filters live, `Enter` locates the
 *    first match and hands the keyboard back to the mindmap, and then `n`/`p`
 *    step to the next/previous match (`/` returns to editing, `Escape` closes
 *    the search). The last non-empty query is remembered and restored the next
 *    time the search opens.
 *  - `Shift+M` centers the selected node in the viewport
 *  - `Shift` + `+` / `-` zoom in/out (hold to zoom smoothly), keeping the
 *    selected node (or the viewport center) fixed
 *  - `Ctrl` + `Shift` + `+` / `-` widen / narrow the selected node, like
 *    dragging its right edge
 *  - `f` toggles child focus mode: the cursor node and its direct
 *    children stay prominent while the rest of the tree is dimmed
 *  - `F` toggles sibling focus mode: all nodes at the cursor's sibling level
 *    stay prominent while the rest of the tree is dimmed
 *  - `?` opens an overlay listing every keyboard and mouse shortcut (`?` or
 *    `Escape` closes it)
 *  - while editing: `Tab`/`Enter` save and add a child/sibling, `Escape` cancels
 *  - right-click a node for the same actions in a menu

 * Every *content* action becomes a source-level edit (see `applyEdit`) written
 * back through `setMarkdown`, so the markdown file stays the source of truth.
 * Node widths are the one exception: they are a view preference stored in the
 * plugin's data file (`setNodeWidth`), never appended to the note.
 */
export function attachNodeEditor({ svg, getMarkdown, getSourceRoots, setMarkdown, getNodeWidths, setNodeWidth, onSourceChange, getAnimationDuration, ensureVisible, centerNode, zoomBy, getZoomAnchor, getZoomRect, getContentZoomAnchor, toggleFold, revealChildren, revealAllChildren, getFoldRoot, applyFoldPlan, fitContent, goToSourceLine, beginLiveLayout, endLiveLayout, relayout }: NodeEditorOptions): NodeEditorHandle {
  const container = svg.parentElement
  container?.setAttribute('tabindex', '-1')
  container?.addClass('advmm-editor-container')

  let selectedPaths: number[][] = []
  let anchorPath: number[] | null = null
  let primaryPath: number[] | null = null
  /** Last non-null selection, kept after deselecting so navigation can resume. */
  let lastPath: number[] | null = null
  /** Nodes marked with `Ctrl+X`, waiting to be pasted. */
  let clipboard: { path: number[]; text: string }[] | null = null
  let pendingPrefix: string | null = null
  /** Whether focus mode dims every node but the cursor and its direct children. */
  let focusMode = false
  /** Whether focus mode currently highlights the cursor's siblings instead. */
  let siblingFocusMode = false

  /** Continuous zoom while a `Shift` + `+` / `-` key is held. */
  let zoomHold: { action: ZoomAction; anchor: ZoomAnchor | undefined; keepVisible: ZoomRect | undefined } | null = null
  let zoomFrame: number | null = null
  let zoomLastTime = 0

  /** Mouse drag-and-drop state. */
  type DragState = { path: number[]; element: SVGGElement; startX: number; startY: number; active: boolean; link: SVGPathElement | null; band: SVGPathElement | null }
  let drag: DragState | null = null
  let dropTarget: DropTarget | null = null
  let dropLine: HTMLDivElement | null = null
  let suppressClick = false

  /** Right-button drag state; d3-zoom pans, we just track whether it moved. */
  let rightDrag: { startX: number; startY: number; moved: boolean } | null = null

  /** Rubber-band selection state (left-drag on empty canvas). */
  let marquee: { startX: number; startY: number; active: boolean; element: HTMLDivElement } | null = null

  /** Mouse drag on the selected node's right edge to set that node's width. */
  type ResizeState = { path: number[]; label: HTMLElement; key: string; startX: number; startWidth: number; scale: number; active: boolean; width: number }
  let resize: ResizeState | null = null
  /** Pending/serialized relayout during a live resize (one per frame at most). */
  let resizeLayoutFrame: number | null = null
  let resizeLayoutRunning = false
  let resizeLayoutAgain = false

  /** Keyboard width change in progress (`Ctrl+Shift` + `+` / `-` held). */
  let keyResize: { path: number[]; label: HTMLElement; key: string; width: number } | null = null

  /** In-progress single-finger touch (long-press then drag/marquee). */
  let touch: {
    startX: number
    startY: number
    path: number[] | null
    group: SVGGElement | null
    longPressed: boolean
    moved: boolean
  } | null = null
  let longPressTimer: number | null = null
  let previousTap: TapPoint | null = null
  /** Timestamp of the last touch, used to ignore the synthetic mouse events. */
  let lastTouchTime = 0

  /** Mobile-only action bars: undo (top-left), redo (top-right), add child/sibling (bottom-right), menu (bottom-center). */
  let undoBar: HTMLDivElement | null = null
  let redoBar: HTMLDivElement | null = null
  let nodeBar: HTMLDivElement | null = null
  let menuBar: HTMLDivElement | null = null
  let foldButton: HTMLButtonElement | null = null
  const actionButtons = new Map<EditorCommand, HTMLButtonElement>()

  /** Overlay listing the `z`-prefixed commands, shown after pressing `z`. */
  let foldHint: HTMLDivElement | null = null

  /** `?` opens a full keyboard/mouse reference overlay. */
  let helpOverlay: HTMLDivElement | null = null
  let helpVisible = false

  /** Search state (`/` opens the bar; `n`/`p`/`Escape` control it). */
  let searchActive = false
  let searchQuery = ''
  let searchMatches: number[][] = []
  let searchIndex = 0
  let searchBar: HTMLDivElement | null = null
  let searchInput: HTMLInputElement | null = null
  let searchCount: HTMLSpanElement | null = null
  /** The most recent non-empty query, restored whenever the search reopens. */
  let lastSearchQuery = ''
  /**
   * Whether the query input is the one being typed into. While it is `true` the
   * input owns the keyboard; if the view steals focus mid-search we hand it back
   * rather than treating the next keystroke as a command.
   */
  let searchEditing = false
  /**
   * Whether an IME composition is in flight in the query input. The caret must
   * not be moved and the DOM selection must not be touched while it is `true`:
   * doing so cancels the composition and the field stops receiving text.
   */
  let searchComposing = false

  /** Undo/redo stacks of whole-document snapshots, plus the last text we wrote. */
  const undoStack: string[] = []
  const redoStack: string[] = []
  let lastWritten: string | null = null
  const MAX_HISTORY = 100

  /**
   * The parsed tree of the markdown the current render was built from. Node
   * paths are recomputed from it on nearly every keystroke (highlighting,
   * navigation, search), so it is parsed once per document instead of once per
   * lookup. Every caller only reads the tree.
   */
  let sourceCache: { markdown: string; roots: SourceNode[]; searchNodes?: ReturnType<typeof collectSearchNodes> } | null = null
  let visibleCache: { dom: NonNullable<typeof dom>, markdown: string, paths: number[][] } | null = null

  /** One bit per class the highlight applies, so a node's state is one number. */
  const SELECTED = 1
  const CUT = 2
  const SEARCH_HIT = 4
  const SEARCH_CURRENT = 8
  const FOCUSED = 16
  const HIGHLIGHT_CLASSES: readonly [number, string][] = [
    [SELECTED, 'advmm-selected'],
    [CUT, 'advmm-cut'],
    [SEARCH_HIT, 'advmm-search-hit'],
    [SEARCH_CURRENT, 'advmm-search-current'],
    [FOCUSED, 'advmm-focus'],
  ]

  /**
   * The rendered nodes, plus the two lookups the editor does on nearly every
   * keystroke: which node holds a source path, and which one starts on a source
   * line. All three used to be a `querySelectorAll` followed by a walk of every
   * node, and adding one child did a dozen of them — the inline editor
   * re-measures the new node on every animation frame. They are rebuilt only
   * when markmap changes the nodes.
   */
  type DomIndex = {
    nodes: SVGGElement[]
    byPath: Map<string, SVGGElement>
    byLine: Map<number, SVGGElement>
  }
  let dom: DomIndex | null = null

  /**
   * Nodes whose classes `applyHighlight` changed, so the next one only has to
   * look at those (plus whatever is highlighted now) instead of every node.
   */
  const highlighted = new Set<SVGGElement>()
  /** Connectors currently marked as leading into a focused node. */
  let focusLinks: SVGPathElement[] = []
  /** The focus set those connectors were computed for. */
  let focusLinksKey = ''
  let dropBoxCache: { dom: DomIndex, boxes: DropBox[] } | null = null

  function sourceRoots(): SourceNode[] {
    const markdown = getMarkdown()
    const supplied = getSourceRoots?.()
    if (supplied) {
      if (sourceCache?.markdown !== markdown || sourceCache.roots !== supplied) {
        sourceCache = { markdown, roots: supplied }
        visibleCache = null
      }
      return supplied
    }
    if (sourceCache?.markdown !== markdown) {
      sourceCache = { markdown, roots: parseSource(markdown) }
      visibleCache = null
    }
    return sourceCache.roots
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (isRecentTouch()) return
    const group = findNodeGroup(event.target)
    const path = group && sourcePathOf(group)
    // The synthetic root cannot be renamed.
    if (!group || !path || path.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    openTextEditor(group, path)
  }

  const onClick = (event: MouseEvent) => {
    if (isRecentTouch()) return
    if (suppressClick) {
      suppressClick = false
      return
    }

    const target = event.target
    const group = target instanceof Element
      ? target.closest('g.markmap-node') as SVGGElement | null
      : null
    const path = group ? sourcePathOf(group) ?? null : null

    if (!path) selectOnly(null)
    else if (event.shiftKey) extendSelection(path)
    else selectOnly(path)

    container?.focus()
  }

  const onContextMenu = (event: MouseEvent) => {
    // iOS fires `contextmenu` on a long press; the action bar replaces it.
    if (isRecentTouch()) {
      event.preventDefault()
      return
    }

    // A right-button drag pans the view (see the zoom filter); don't also open
    // the menu once the button is released.
    if (rightDrag?.moved) {
      rightDrag = null
      event.preventDefault()
      return
    }
    rightDrag = null

    const group = findNodeGroup(event.target)
    const path = group && sourcePathOf(group)
    if (!group || !path) return

    event.preventDefault()
    event.stopPropagation()
    // The synthetic root has no source line, so only show node menus for real
    // nodes.
    if (path.length > 0) openMenu(event, group, path)
  }

  const onMouseDown = (event: MouseEvent) => {
    suppressClick = false
    if (isRecentTouch()) return

    // Right button: let d3-zoom pan (see the zoom filter); just remember where
    // the press started so the context menu can be suppressed after a drag.
    if (event.button === 2) {
      rightDrag = { startX: event.clientX, startY: event.clientY, moved: false }
      return
    }

    if (event.button !== 0 || isTextInput(event.target)) return

    const group = findAnyNodeGroup(event.target)
    if (!group) return

    // Stop the event before it reaches d3-zoom, which would otherwise pan the
    // mindmap while we are dragging a node.
    event.stopPropagation()
    event.preventDefault()

    const path = sourcePathOf(group)
    if (!path) return

    // Pressing the selected node's right edge resizes it instead of moving it.
    if (beginResize(path, group, event.clientX, event.clientY)) return

    beginNodeDrag(path, group, event.clientX, event.clientY)
  }

  const onMouseMove = (event: MouseEvent) => {
    if (isRecentTouch()) return

    if (rightDrag && !rightDrag.moved && (event.buttons & 2)) {
      const dx = event.clientX - rightDrag.startX
      const dy = event.clientY - rightDrag.startY
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_SQUARED) rightDrag.moved = true
    }

    if (resize) {
      event.preventDefault()
      expandResize(event.clientX)
      return
    }

    if (marquee) {
      event.preventDefault()
      expandMarquee(event.clientX, event.clientY)
      return
    }

    if (drag) {
      event.preventDefault()
      expandNodeDrag(event.clientX, event.clientY)
      return
    }

    // Hint that the selected node's right edge can be dragged. Written only
    // when the state changes so a plain mouse move never touches the DOM.
    if (event.buttons === 0 && event.target instanceof Element) {
      const group = event.target.closest('g.markmap-node') as SVGGElement | null
      const path = group ? sourcePathOf(group) : undefined
      const overHandle = !!group && !!path && resizeHandleAt(group, path, event.clientX, event.clientY)
      const cursor = overHandle ? 'ew-resize' : ''
      if (svg.style.cursor !== cursor) svg.setCssStyles({ cursor })
    }
  }

  const onMouseUp = (event: MouseEvent) => {
    if (isRecentTouch()) return

    if (resize) {
      event.preventDefault()
      event.stopPropagation()
      // The click that follows would otherwise clear the selection.
      if (finishResize()) suppressClick = true
      return
    }

    if (marquee) {
      event.preventDefault()
      event.stopPropagation()
      // The click that follows would otherwise clear the new selection.
      if (finishMarquee(event.clientX, event.clientY)) suppressClick = true
      return
    }

    if (drag) {
      event.preventDefault()
      event.stopPropagation()
      if (finishNodeDrag(event.clientX, event.clientY)) suppressClick = true
    }
  }

  /**
   * Clicking outside the query is the deliberate way to leave it; track that so
   * the focus-recovery below does not fight a real click on the canvas, another
   * pane, the ribbon, ...
   */
  const onDocumentMouseDown = (event: MouseEvent) => {
    if (searchActive && !searchBar?.contains(event.target as Node)) searchEditing = false
  }

  const onContainerMouseDown = (event: MouseEvent) => {
    suppressClick = false
    if (isRecentTouch()) return
    if (event.button !== 0 || isTextInput(event.target)) return
    if (!(event.target instanceof Node) || !svg.contains(event.target)) return
    // Pressing a node starts a node drag (handled on the svg itself).
    if (findAnyNodeGroup(event.target)) return

    // Empty canvas: draw a selection box. Intercept on the container so the
    // event never reaches d3-zoom, which would pan the mindmap instead.
    event.stopPropagation()
    event.preventDefault()
    beginMarquee(event.clientX, event.clientY)
  }

  /** The existing link that connects the dragged node to its parent. */
  function dragSourceLink(path: number[]): SVGPathElement | null {
    for (const link of Array.from(svg.querySelectorAll<SVGPathElement>('path.markmap-link'))) {
      const data = (link as unknown as { __data__?: { source?: IPureNode; target?: IPureNode } }).__data__
      const targetPath = data?.target ? getSourcePath(data.target) : undefined
      if (!targetPath || !samePath(targetPath, path)) continue
      const parentPath = data?.source ? getSourcePath(data.source) : undefined
      if (!parentPath) return null
      return link
    }
    return null
  }

  /**
   * Convert a pointer position from viewport coordinates into the tree
   * coordinate system used by the markmap zoom group.
   */
  function treePoint(clientX: number, clientY: number): { x: number; y: number } {
    const zoomGroup = svg.querySelector<SVGGElement>(':scope > g')
    const ctm = zoomGroup?.getScreenCTM?.()
    if (ctm) {
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      return pt.matrixTransform(ctm.inverse())
    }
    // jsdom / missing-CTM fallback — returns the pointer as-is (tests only).
    return { x: clientX, y: clientY }
  }

  /** d3.linkHorizontal() cubic-bezier shape (horizontal at both ends). */
  function bezierD(sx: number, sy: number, tx: number, ty: number): string {
    const dx3 = (tx - sx) / 3
    return `M ${sx},${sy} C ${sx + dx3},${sy} ${tx - dx3},${ty} ${tx},${ty}`
  }

  /**
   * Marks the drag as active: dims the node and draws a rubber-band path
   * from the parent anchor to the pointer.  Colour and shape match the
   * existing connector line.
   */
  function activateDrag(state: DragState, x: number, y: number) {
    state.active = true
    state.element.classList.add('advmm-dragging')
    container?.addClass('advmm-dragging')

    state.link = dragSourceLink(state.path)
    if (!state.link) return
    const style = getComputedStyle(state.link)
    const zoomGroup = state.link.parentElement
    if (!zoomGroup) return

    const start = state.link.getPointAtLength(0)
    const end = treePoint(x, y)

    state.band = createSvg('path')
    state.band.classList.add('markmap-link', 'advmm-drag-link')
    state.band.setAttribute('fill', 'none')
    state.band.setAttribute('stroke', style.stroke || style.color || 'currentColor')
    state.band.setAttribute('stroke-width', style.strokeWidth || '1.5')
    state.band.setAttribute('d', bezierD(start.x, start.y, end.x, end.y))
    zoomGroup.appendChild(state.band)
  }

  /** Undoes {@link activateDrag} (kept symmetric so the path can never linger). */
  function deactivateDrag(state: DragState) {
    state.element.classList.remove('advmm-dragging')
    container?.removeClass('advmm-dragging')
    state.band?.remove()
    state.band = null
    state.link = null
  }

  function beginNodeDrag(path: number[], element: SVGGElement, x: number, y: number) {
    // The synthetic root has no source line and cannot be moved.
    if (path.length === 0) return
    drag = { path, element, startX: x, startY: y, active: false, link: null, band: null }
  }

  /** Moves the dragged node; once active the rubber-band bezier is updated. */
  function expandNodeDrag(x: number, y: number) {
    if (!drag) return

    if (!drag.active) {
      const dx = x - drag.startX
      const dy = y - drag.startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED) return

      activateDrag(drag, x, y)
    }

    if (drag.band && drag.link) {
      const start = drag.link.getPointAtLength(0)
      const end = treePoint(x, y)
      drag.band.setAttribute('d', bezierD(start.x, start.y, end.x, end.y))
    }
    setDropTarget(dropPositionAt(x, y))
  }

  /** Finishes a node drag; returns true when the node was actually moved. */
  function finishNodeDrag(_x: number, _y: number): boolean {
    const state = drag
    const target = dropTarget
    if (!state) return false

    drag = null
    deactivateDrag(state)
    setDropTarget(null)

    if (!state.active || !target) return false

    void moveTo(state.path, target)
    return true
  }

  /** The current zoom scale (content pixels -> screen pixels). */
  function zoomScale(): number {
    const zoomGroup = svg.querySelector<SVGGElement>(':scope > g')
    const ctm = zoomGroup?.getScreenCTM?.()
    if (ctm) {
      const scale = Math.hypot(ctm.a, ctm.b)
      if (Number.isFinite(scale) && scale > 0) return scale
    }
    return 1
  }

  /**
   * True when the pointer is on the right edge of the selected node, the only
   * place a press resizes instead of moving the node.
   */
  function resizeHandleAt(group: SVGGElement, path: number[], x: number, y: number): boolean {
    if (selectedPaths.length !== 1 || !primaryPath || !samePath(primaryPath, path)) return false

    const rect = nodeLabel(group)?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return false

    return x >= rect.right - RESIZE_EDGE_ZONE
      && x <= rect.right + RESIZE_EDGE_ZONE
      && y >= rect.top
      && y <= rect.bottom
  }

  /** Starts a resize drag; returns false when the press is a normal node move. */
  function beginResize(path: number[], group: SVGGElement, x: number, y: number): boolean {
    if (!resizeHandleAt(group, path, x, y)) return false

    // Only nodes that map back to a source line have a width key; render-only
    // nodes (synthetic root, note title) are never resized.
    const key = nodeWidthKey(group)
    if (!key) return false

    const label = nodeLabel(group)
    if (!label) return false

    resize = {
      path,
      label,
      key,
      startX: x,
      startWidth: label.offsetWidth || label.getBoundingClientRect().width / zoomScale(),
      scale: zoomScale(),
      active: false,
      width: 0,
    }
    svg.setCssStyles({ cursor: 'ew-resize' })
    return true
  }

  /**
   * Makes the dragged node's box match its new width right away.
   *
   * markmap sizes `foreignObject` from its last measurement and clips anything
   * outside it: without this the wrapped lines below the old height disappear
   * (looks like the text was cut) and a widened box cannot grow past the old
   * width until the next layout. Updating the two attributes is cheap and makes
   * the box and text track the pointer exactly; `scheduleResizeLayout()` then
   * moves the children, links and fold circle a frame later.
   */
  function syncResizeBox(label: HTMLElement) {
    const width = label.scrollWidth
    const height = label.scrollHeight
    if (width <= 0 || height <= 0) return

    const foreign = label.parentElement?.parentElement
    if (!foreign || foreign.tagName.toLowerCase() !== 'foreignobject') return
    foreign.setAttribute('width', String(width))
    foreign.setAttribute('height', String(height))
  }

  /** Re-applies the stored widths after they changed outside a live drag. */
  function refreshNodeWidths() {
    if (applyNodeWidths(svg, getNodeWidths?.() ?? {})) void relayout?.()
  }

  /** Relayouts at most once per frame, always with the latest dragged width. */
  function scheduleResizeLayout() {
    if (!relayout) return
    if (resizeLayoutFrame !== null || resizeLayoutRunning) {
      resizeLayoutAgain = true
      return
    }
    resizeLayoutFrame = window.requestAnimationFrame(() => {
      resizeLayoutFrame = null
      resizeLayoutRunning = true
      void Promise.resolve(relayout()).catch(() => undefined).finally(() => {
        resizeLayoutRunning = false
        if (!resizeLayoutAgain) return
        resizeLayoutAgain = false
        if (resize || keyResize) scheduleResizeLayout()
      })
    })
  }

  /** Stops live layout and restores the normal animation duration. */
  function stopResizeLayout() {
    resizeLayoutAgain = false
    if (resizeLayoutFrame !== null) {
      window.cancelAnimationFrame(resizeLayoutFrame)
      resizeLayoutFrame = null
    }
    endLiveLayout?.()
  }

  /** Live-previews the dragged width without saving it. */
  function expandResize(x: number) {
    if (!resize) return

    const dx = x - resize.startX
    if (!resize.active) {
      if (Math.abs(dx) < RESIZE_MIN_DELTA) return
      resize.active = true
      container?.addClass('advmm-resizing')
      beginLiveLayout?.()
    }

    const width = clampNodeWidth(resize.startWidth + dx / resize.scale)
    resize.width = width
    resize.label.setCssStyles({ width: `${width}px` })
    syncResizeBox(resize.label)
    scheduleResizeLayout()
  }

  /**
   * `Ctrl+Shift` + `+` / `-`: widen or narrow the selected node, the keyboard
   * equivalent of dragging its right edge. Auto-repeat keeps stepping; the
   * width is stored once, when the key is released.
   */
  function nudgeNodeWidth(action: ResizeAction) {
    if (!primaryPath || primaryPath.length === 0) return

    if (keyResize && (!samePath(keyResize.path, primaryPath) || !keyResize.label.isConnected)) finishKeyResize()
    const group = keyResize ? null : findGroupByPath(primaryPath)
    const label = keyResize?.label ?? (group ? nodeLabel(group) : null)
    const key = keyResize?.key ?? (group ? nodeWidthKey(group) : undefined)
    if (!label || !key) return

    const current = keyResize?.width ?? (label.offsetWidth || label.getBoundingClientRect().width / zoomScale())
    if (!(current > 0)) return

    const width = clampNodeWidth(current + (action === 'wider' ? KEY_RESIZE_STEP : -KEY_RESIZE_STEP))
    if (width === current) return

    if (!keyResize) {
      keyResize = { path: [...primaryPath], label, key, width: current }
      beginLiveLayout?.()
    }
    keyResize.width = width
    label.setCssStyles({ width: `${width}px` })
    syncResizeBox(label)
    scheduleResizeLayout()
  }

  /** Stores the width chosen with `Ctrl+Shift` + `+` / `-` (never in the note). */
  function finishKeyResize() {
    const state = keyResize
    if (!state) return

    keyResize = null
    stopResizeLayout()
    if (!setNodeWidth?.(state.key, state.width)) refreshNodeWidths()
  }

  /** Drops an unfinished keyboard resize without saving it (editor teardown). */
  function discardKeyResize() {
    if (!keyResize) return
    keyResize = null
    stopResizeLayout()
    refreshNodeWidths()
  }

  /** Finishes a resize; returns true when a resize gesture happened. */
  function finishResize(): boolean {
    const state = resize
    if (!state) return false

    resize = null
    stopResizeLayout()
    container?.removeClass('advmm-resizing')
    svg.setCssStyles({ cursor: '' })
    if (!state.active) return false

    if (setNodeWidth) setNodeWidth(state.key, state.width)
    else refreshNodeWidths()
    return true
  }

  /** Removes the node's own width so it follows the global `maxWidth` again. */
  function resetWidth(path: number[]) {
    const group = findGroupByPath(path)
    const key = group ? nodeWidthKey(group) : undefined
    if (!key) return

    selectOnly(path)
    if (setNodeWidth?.(key, null)) refreshNodeWidths()
  }

  /** Cancels a resize mid-drag and restores the width from the last render. */
  function cancelResize() {
    if (!resize) return
    resize = null
    stopResizeLayout()
    container?.removeClass('advmm-resizing')
    svg.setCssStyles({ cursor: '' })
    refreshNodeWidths()
  }

  function beginMarquee(x: number, y: number) {
    const element = createDiv('advmm-marquee')
    document.body.appendChild(element)
    marquee = { startX: x, startY: y, active: false, element }
  }

  /** Grows the marquee box and previews which nodes it covers. */
  function expandMarquee(x: number, y: number) {
    if (!marquee) return

    const dx = x - marquee.startX
    const dy = y - marquee.startY
    if (!marquee.active) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED) return
      marquee.active = true
    }

    marquee.element.setCssStyles({
      left: `${Math.min(marquee.startX, x)}px`,
      top: `${Math.min(marquee.startY, y)}px`,
      width: `${Math.abs(dx)}px`,
      height: `${Math.abs(dy)}px`,
    })

    previewMarquee(pathsInRect(marquee.startX, marquee.startY, x, y))
  }

  /** Finishes a marquee; returns true when a selection was applied. */
  function finishMarquee(x: number, y: number): boolean {
    const box = marquee
    if (!box) return false

    marquee = null
    box.element.remove()
    if (!box.active) return false

    setSelection(pathsInRect(box.startX, box.startY, x, y))
    container?.focus()
    return true
  }

  /** Paths of the rendered nodes whose box overlaps the given client rect. */
  function pathsInRect(x1: number, y1: number, x2: number, y2: number): number[][] {
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)

    const paths: number[][] = []
    for (const group of groups()) {
      const path = sourcePathOf(group)
      if (!path) continue

      const rect = group.getBoundingClientRect()
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top)
        paths.push(path)
    }

    // DOM order is not guaranteed to be document order after re-renders.
    const rank = new Map(visiblePaths().map((path, index) => [pathKey(path), index]))
    return paths.sort((a, b) => (rank.get(pathKey(a)) ?? 0) - (rank.get(pathKey(b)) ?? 0))
  }

  /** Highlights the nodes a marquee currently covers (without selecting them). */
  function previewMarquee(paths: number[][]) {
    const covered = new Set(paths.map(pathKey))
    for (const group of groups()) {
      const path = sourcePathOf(group)
      group.classList.toggle('advmm-selected', !!path && covered.has(pathKey(path)))
    }
  }

  // ---- touch (mobile) ------------------------------------------------------

  /** True while the synthetic mouse events that follow a touch still arrive. */
  function isRecentTouch(): boolean {
    return Date.now() - lastTouchTime < 1000
  }

  function cancelLongPress() {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  /** Abandons a touch gesture without applying it (pinch, cancel). */
  function abortTouchGesture() {
    cancelLongPress()
    touch = null

    if (drag) deactivateDrag(drag)
    drag = null
    setDropTarget(null)

    if (marquee) {
      marquee.element.remove()
      marquee = null
    }
  }

  /** Long press: start dragging the pressed node, or a selection box on empty canvas. */
  function startLongPress() {
    longPressTimer = null
    const state = touch
    if (!state || state.longPressed || state.moved) return

    state.longPressed = true

    // d3-zoom is already tracking this touch; cancel it before it pans.
    delete (svg as unknown as { __zooming?: unknown }).__zooming

    if (state.path && state.group) {
      beginNodeDrag(state.path, state.group, state.startX, state.startY)
      if (drag) activateDrag(drag, state.startX, state.startY)
    } else {
      beginMarquee(state.startX, state.startY)
    }

    navigator.vibrate?.(10)
  }

  const onTouchStart = (event: TouchEvent) => {
    lastTouchTime = Date.now()
    suppressClick = false
    cancelLongPress()

    if (event.touches.length > 1) {
      abortTouchGesture()
      return
    }
    if (isTextInput(event.target) || isInteractiveTarget(event.target)) return

    const point = event.touches[0]
    if (!point) return

    const group = findAnyNodeGroup(event.target)
    touch = {
      startX: point.clientX,
      startY: point.clientY,
      path: group ? sourcePathOf(group) ?? null : null,
      group,
      longPressed: false,
      moved: false,
    }

    // Stop the browser from scrolling, selecting text, or synthesising a click.
    event.preventDefault()
    longPressTimer = window.setTimeout(startLongPress, LONG_PRESS_MS)
  }

  const onTouchMove = (event: TouchEvent) => {
    lastTouchTime = Date.now()
    const state = touch
    if (!state) return

    if (event.touches.length > 1) {
      state.moved = true
      if (state.longPressed) abortTouchGesture()
      else cancelLongPress()
      return
    }

    const point = event.touches[0]
    if (!point) return

    if (state.longPressed) {
      event.preventDefault()
      if (drag) expandNodeDrag(point.clientX, point.clientY)
      else expandMarquee(point.clientX, point.clientY)
      return
    }

    if (movedBeyondThreshold(state.startX, state.startY, point.clientX, point.clientY)) {
      state.moved = true
      cancelLongPress()
    }
  }

  const onTouchEnd = (event: TouchEvent) => {
    lastTouchTime = Date.now()
    cancelLongPress()

    const state = touch
    if (!state) return

    if (event.touches.length > 0) {
      // Another finger is still down (a pinch) - abandon this gesture.
      abortTouchGesture()
      return
    }
    touch = null

    const point = event.changedTouches[0]
    const x = point?.clientX ?? state.startX
    const y = point?.clientY ?? state.startY

    if (state.longPressed) {
      event.preventDefault()
      if (drag && finishNodeDrag(x, y)) suppressClick = true
      else if (marquee && finishMarquee(x, y)) suppressClick = true
      return
    }

    if (state.moved) return

    if (!state.path) {
      previousTap = null
      selectOnly(null)
      container?.focus()
      return
    }

    const time = Date.now()
    const doubleTap = isDoubleTap(previousTap, time, x, y)
    previousTap = { time, x, y }

    if (tapAction({ onNode: true, doubleTap }) === 'edit' && state.group && state.path.length > 0) {
      previousTap = null
      openTextEditor(state.group, state.path)
    } else {
      selectOnly(state.path)
      container?.focus()
    }
  }

  const onTouchCancel = () => {
    lastTouchTime = Date.now()
    abortTouchGesture()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTextInput(event.target)) return

    // Lone modifiers (Shift, Ctrl, ...) must not end a `z` sequence: Shift is
    // pressed *before* the `A` that completes `zA`. The hint stays visible.
    if (isModifierKey(event.key)) return

    // Any other keypress ends the `z` hint; it is re-shown below when a new
    // sequence starts.
    hideFoldHint()

    // While the search bar is open `n`/`p` step through the matches and
    // `Escape` closes it (the document-level listener normally handles these
    // first; this is the fallback when the event is dispatched on the editor).
    if (searchActive && handleSearchKey(event, searchEditing)) return

    // `?` toggles the full keyboard-shortcut overlay. While it is open any
    // other key closes it first, so `Escape` hides the overlay instead of
    // clearing the selection (and typing is unaffected: text fields return
    // early above).
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      toggleHelp()
      return
    }
    if (helpVisible) {
      hideHelp()
      if (event.key === 'Escape') {
        event.preventDefault()
        return
      }
    }

    // `/` opens the search bar.
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      openSearch()
      return
    }

    const clipboardCommand = clipboardCommandForEvent(event)
    if (clipboardCommand && runClipboardCommand(clipboardCommand)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // Two-key commands (`zc`/`zo`/`zO`/`za`) are resolved first so they also work
    // with nothing selected.
    const sequence = resolveFoldSequence(pendingPrefix, event.key)

    // `gd` jumps to the selected node's line in the markdown source.
    if (handleGoToDefSequence(event.key)) {
      event.preventDefault()
      return
    }

    // The fold block only handles its own `z` prefix.
    if (pendingPrefix === FOLD_PREFIX || sequence.pending || sequence.action) {
      event.preventDefault()
      if (event.key === 'Escape') {
        pendingPrefix = null
        return
      }
      pendingPrefix = sequence.pending
      if (pendingPrefix === FOLD_PREFIX) showFoldHint()
      if (sequence.action) applyFoldAction(sequence.action)
      return
    }

    // `Ctrl` + `Shift` + `+` / `-` resize the selected node, the keyboard
    // equivalent of dragging its right edge.
    const resizeCommand = resizeCommandForEvent(event)
    if (resizeCommand) {
      event.preventDefault()
      event.stopPropagation()
      nudgeNodeWidth(resizeCommand)
      return
    }

    // `Shift` + `+` / `-` zoom the view. Unlike the node actions this works with
    // or without a selection; a selected node stays pinned at the center of the
    // zoom (the viewport center is used when nothing is selected).
    const zoom = zoomCommandForEvent(event)
    if (zoom) {
      event.preventDefault()
      event.stopPropagation()
      // Key auto-repeat must not restart the step: the rAF loop drives the hold.
      if (!zoomHold || zoomHold.action !== zoom) startZoom(zoom)
      return
    }

    // `Escape` clears the selection.
    if (event.key === 'Escape') {
      if (selectedPaths.length > 0) {
        event.preventDefault()
        selectOnly(null)
      }
      return
    }

    const direction = directionForKey(event.key)

    // With nothing selected the first navigation key places the cursor on a
    // sensible "home" node rather than moving (there is no current node yet).
    if (selectedPaths.length === 0) {
      // Tab is the one node action that needs no current node: the root is the
      // natural anchor, so it adds a new top-level node exactly like Tab on the
      // (synthetic) root. Without this a freshly opened map swallows Tab and
      // Obsidian's own focus traversal moves focus instead.
      if (event.key === 'Tab') {
        event.preventDefault()
        void addNode([], 'addChild')
        return
      }
      if (!direction) return
      const home = homePath()
      if (!home) return
      event.preventDefault()
      selectAndReveal(home)
      return
    }

    if (direction) {
      event.preventDefault()
      navigate(direction, event.shiftKey)
      return
    }

    const action = nodeActionForKey(event.key)
    if (!action) return

    event.preventDefault()
    // `Shift+M` centers the selected node; it works for the synthetic root too.
    if (action === 'center') { centerSelected(); return }
    // Focus mode works for the synthetic root too.
    if (action === 'focus') { toggleFocus(false); return }
    if (action === 'focusSiblings') { toggleFocus(true); return }
    // `J`/`K` reorder the selected node among its siblings.
    if (action === 'moveDown' || action === 'moveUp') {
      void reorderSelection(action === 'moveDown' ? 1 : -1)
      return
    }
    // The synthetic root has no source line: it cannot be edited, removed or
    // given a sibling, but new nodes can still be added below it (they become
    // new top-level nodes).
    if (primaryPath && primaryPath.length === 0 && action !== 'addChild') return
    if (action === 'remove') void removeSelection()
    else if (action === 'edit') editSelected()
    else if (primaryPath) void addNode(primaryPath, action)
  }

  /** Stops a held zoom when its key (or a modifier) is released. */
  const onKeyUp = (event: KeyboardEvent) => {
    const isPlusMinus = event.key === '+' || event.key === '_' || event.key === '-' || event.key === '='
    if (keyResize && (isPlusMinus || isModifierKey(event.key))) finishKeyResize()
    if (!zoomHold) return
    if (isPlusMinus || isModifierKey(event.key)) stopZoom()
  }

  const onBlur = () => {
    hideFoldHint()
    cancelResize()
    finishKeyResize()
    stopZoom()
  }

  // Re-apply the selection highlight whenever markmap re-renders the nodes.
  // markmap overwrites the `class` attribute of every node on each render, so
  // attribute changes (not just node insertion/removal) must be observed too.
  // Only structural changes can change which node a path or a line maps to, so
  // only those drop the node index: doing it for our own class writes would
  // rebuild it on every keystroke.
  //
  // The re-apply runs in a microtask, not in a `requestAnimationFrame`: markmap
  // finishes a render by letting its ResizeObserver schedule another
  // `renderData` ~100ms later (new node content is measured), and that second
  // render rewrites every node's `class` again. A rAF callback lands one full
  // frame after that rewrite, so a freshly added node visibly loses its
  // highlight for a frame. A microtask restores it within the same frame, which
  // makes the flicker imperceptible. `applyHighlight` only writes classes that
  // actually change, so its own writes settle after one extra no-op pass.
  let highlightScheduled = false
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type !== 'attributes')) {
      dom = null
      dropBoxCache = null
      visibleCache = null
      // The connectors may be new elements too, so they are marked again.
      focusLinksKey = ''
    }
    if (highlightScheduled || (selectedPaths.length === 0 && !clipboard && !searchActive)) return
    highlightScheduled = true
    queueMicrotask(() => {
      highlightScheduled = false
      applyHighlight()
    })
  })
  observer.observe(svg, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

  // ---- mobile action bar ---------------------------------------------------

  const ACTION_LABELS: Record<EditorCommand, string> = {
    edit: strings.nodeEditor.edit,
    addChild: strings.nodeEditor.addChild,
    addSibling: strings.nodeEditor.addSibling,
    remove: strings.nodeEditor.remove,
    focus: strings.nodeEditor.focus,
    fold: strings.nodeEditor.fold,
    unfold: strings.nodeEditor.unfold,
    cut: strings.nodeEditor.cut,
    paste: strings.nodeEditor.paste,
    undo: strings.nodeEditor.undo,
    redo: strings.nodeEditor.redo,
  }

  const ACTION_ICONS: Record<EditorCommand, string> = {
    edit: 'pencil',
    addChild: 'indent',
    addSibling: 'outdent',
    remove: 'trash',
    focus: 'focus',
    fold: 'chevrons-down-up',
    unfold: 'chevrons-up-down',
    cut: 'scissors',
    paste: 'clipboard-paste',
    undo: 'undo',
    redo: 'redo',
  }

  /** Labels for the `z` hint overlay, one per fold action. */
  const FOLD_HINT_LABELS: Record<FoldAction, string> = {
    fold: strings.nodeEditor.hintFold,
    foldLevel: strings.nodeEditor.hintFoldLevel,
    unfold: strings.nodeEditor.hintUnfold,
    unfoldAll: strings.nodeEditor.hintUnfoldAll,
    toggleAll: strings.nodeEditor.hintToggleAll,
  }

  function actionState(): ActionState {
    const data = primaryNodeData()
    return {
      selectedCount: selectedPaths.length,
      folded: !!data?.children?.length && !!data.payload?.fold,
      focused: focusMode || siblingFocusMode,
      hasClipboard: clipboard !== null,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    }
  }

  function setActionButton(button: HTMLButtonElement, command: EditorCommand, disabled: boolean, active: boolean) {
    button.disabled = disabled
    button.toggleClass('advmm-action-active', active)
    if (button.dataset.command === command) return

    button.dataset.command = command
    button.setAttribute('aria-label', ACTION_LABELS[command])
    button.setAttribute('title', ACTION_LABELS[command])
    setIcon(button, ACTION_ICONS[command])
  }

  function createCommandButton(parent: HTMLElement, command: EditorCommand): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'advmm-action' })
    setActionButton(button, command, false, false)
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      runEditorCommand(button.dataset.command as EditorCommand)
    })
    return button
  }

  function updateActionBar() {
    const state = actionState()

    undoBar?.toggleClass('advmm-hidden', !state.canUndo)
    redoBar?.toggleClass('advmm-hidden', !state.canRedo)
    nodeBar?.toggleClass('advmm-hidden', state.selectedCount === 0)
    menuBar?.toggleClass('advmm-hidden', state.selectedCount === 0 && !state.hasClipboard)

    for (const { command, disabled, active } of editorActions(state)) {
      const button =
        command === 'fold' || command === 'unfold'
          ? foldButton
          : actionButtons.get(command)
      if (button) setActionButton(button, command, disabled, active)
    }
  }

  function runEditorCommand(command: EditorCommand) {
    // The synthetic root is render-only: it has no source line to edit, remove
    // or anchor new nodes on.
    const editable = !!primaryPath && primaryPath.length > 0
    switch (command) {
      case 'edit': {
        if (!editable || !primaryPath) return
        const group = findGroupByPath(primaryPath)
        if (group) openTextEditor(group, primaryPath)
        return
      }
      case 'addChild': if (primaryPath) void addNode(primaryPath, 'addChild'); return
      case 'addSibling': if (editable && primaryPath) void addNode(primaryPath, 'addSibling'); return
      case 'remove': void removeSelection(); return
      case 'focus': toggleFocus(false); return
      case 'fold': void foldSelected(); return
      case 'unfold': void revealSelectedOneLevel(); return
      case 'cut': {
        const paths = selectedPaths.filter(path => path.length > 0)
        if (paths.length > 0) cutNode(paths)
        return
      }
      case 'paste': if (clipboard && editable && primaryPath) void pasteInto(primaryPath); return
      case 'undo': void undo(); return
      case 'redo': void redo(); return
    }
  }

  function setupActionBar() {
    if (!Platform.isMobile || menuBar || !container) return

    undoBar = container.createDiv('advmm-action-bar advmm-action-top-left advmm-hidden')
    actionButtons.set('undo', createCommandButton(undoBar, 'undo'))

    redoBar = container.createDiv('advmm-action-bar advmm-action-top-right advmm-hidden')
    actionButtons.set('redo', createCommandButton(redoBar, 'redo'))

    nodeBar = container.createDiv('advmm-action-bar advmm-action-node advmm-hidden')
    actionButtons.set('addChild', createCommandButton(nodeBar, 'addChild'))
    actionButtons.set('addSibling', createCommandButton(nodeBar, 'addSibling'))

    menuBar = container.createDiv('advmm-action-bar advmm-action-menu advmm-hidden')
    actionButtons.set('edit', createCommandButton(menuBar, 'edit'))
    actionButtons.set('remove', createCommandButton(menuBar, 'remove'))
    actionButtons.set('focus', createCommandButton(menuBar, 'focus'))
    foldButton = createCommandButton(menuBar, 'fold')
    actionButtons.set('cut', createCommandButton(menuBar, 'cut'))
    actionButtons.set('paste', createCommandButton(menuBar, 'paste'))

    updateActionBar()
  }

  setupActionBar()

  svg.addEventListener('dblclick', onDoubleClick, true)
  svg.addEventListener('click', onClick, true)
  svg.addEventListener('contextmenu', onContextMenu, true)
  svg.addEventListener('mousedown', onMouseDown, true)
  svg.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
  svg.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  svg.addEventListener('touchend', onTouchEnd, { capture: true, passive: false })
  svg.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: false })
  container?.addEventListener('mousedown', onContainerMouseDown, true)
  container?.ownerDocument?.addEventListener('mousedown', onDocumentMouseDown, true)
  container?.ownerDocument?.addEventListener('keydown', onDocumentKeyDown, true)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  // Listen on the window so a zoom also stops if the key is released after
  // focus moved away from the editor.
  window.addEventListener('keyup', onKeyUp)
  // If the window loses focus mid-hold the keyup never arrives.
  window.addEventListener('blur', onBlur)
  container?.addEventListener('keydown', onKeyDown)
  container?.addEventListener('blur', onBlur)

  return {
    destroy() {
      observer.disconnect()
      cancelResize()
      discardKeyResize()
      abortTouchGesture()
      stopZoom()
      undoBar?.remove()
      redoBar?.remove()
      nodeBar?.remove()
      menuBar?.remove()
      searchBar?.remove()
      foldHint?.remove()
      helpOverlay?.remove()
      dropLine?.remove()
      if (drag) deactivateDrag(drag)
      drag = null
      undoBar = null
      redoBar = null
      nodeBar = null
      menuBar = null
      searchBar = null
      searchInput = null
      searchCount = null
      dropLine = null
      searchActive = false
      searchEditing = false
      searchComposing = false
      searchMatches = []
      searchIndex = 0
      foldHint = null
      helpOverlay = null
      helpVisible = false
      svg.removeEventListener('dblclick', onDoubleClick, true)
      svg.removeEventListener('click', onClick, true)
      svg.removeEventListener('contextmenu', onContextMenu, true)
      svg.removeEventListener('mousedown', onMouseDown, true)
      svg.removeEventListener('touchstart', onTouchStart, { capture: true })
      svg.removeEventListener('touchmove', onTouchMove, { capture: true })
      svg.removeEventListener('touchend', onTouchEnd, { capture: true })
      svg.removeEventListener('touchcancel', onTouchCancel, { capture: true })
      container?.removeEventListener('mousedown', onContainerMouseDown, true)
      container?.ownerDocument?.removeEventListener('mousedown', onDocumentMouseDown, true)
      container?.ownerDocument?.removeEventListener('keydown', onDocumentKeyDown, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      container?.removeEventListener('keydown', onKeyDown)
      container?.removeEventListener('blur', onBlur)
    },
    focus() {
      container?.focus()
    },
  }

  function groups(): SVGGElement[] {
    return domIndex().nodes
  }

  function domIndex() {
    // A re-render replaces the nodes. The observer above reports that, but only
    // asynchronously, so the cache is checked for liveness as well.
    if (dom && (dom.nodes.length === 0 || dom.nodes[0].isConnected)) return dom

    const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
    const byPath = new Map<string, SVGGElement>()
    const byLine = new Map<number, SVGGElement>()
    for (const group of nodes) {
      const data = nodeData(group)
      const path = data ? getSourcePath(data) : undefined
      if (path) byPath.set(pathKey(path), group)
      const line = nodeStartLine(data)
      if (line !== undefined && !byLine.has(line)) byLine.set(line, group)
    }
    dom = { nodes, byPath, byLine }
    return dom
  }

  function nodeData(group: SVGGElement): IPureNode | undefined {
    return (group as unknown as { __data__?: IPureNode }).__data__
  }

  /** Start line of a rendered node, taken from markmap's `data-lines` payload. */
  function nodeStartLine(data: IPureNode | undefined): number | undefined {
    const lines = data?.payload?.lines
    if (typeof lines !== 'string') return undefined
    const start = Number.parseInt(lines.split(',')[0], 10)
    return Number.isNaN(start) ? undefined : start
  }

  function sourcePathOf(group: SVGGElement): number[] | undefined {
    const data = nodeData(group)
    return data ? getSourcePath(data) : undefined
  }

  function sourceText(path: number[]): string | undefined {
    try {
      return getNodeAtPath(sourceRoots(), path).text
    } catch {
      return undefined
    }
  }

  function selectOnly(path: number[] | null) {
    setSelection(path ? [path] : [])
  }

  /** Replaces the selection with `paths` (already in document order). */
  function setSelection(paths: number[][]) {
    selectedPaths = paths
    anchorPath = paths[0] ?? null
    primaryPath = paths[paths.length - 1] ?? null
    if (primaryPath) lastPath = primaryPath
    pendingPrefix = null
    applyHighlight()
  }

  /** Shift-click: selects every node between the anchor and `path`. */
  function extendSelection(path: number[]) {
    selectedPaths = pathRange(sourceRoots(), anchorPath ?? path, path)
    primaryPath = path
    lastPath = path
    applyHighlight()
  }

  function applyHighlight() {
    clearNativeSelection(container?.ownerDocument)
    const primary = primaryNodeData()
    const focused = primaryPath && primary
      ? focusMode
        ? focusPaths(primaryPath, primary)
        : siblingFocusMode
          ? siblingPaths(primaryPath, sourceRoots())
          : []
      : []

    container?.toggleClass('advmm-focus-mode', focused.length > 0)

    // Which node gets which class, as one bit per class. The nodes are looked
    // up through the index (constant time each) rather than by walking every
    // rendered node, and only the nodes that actually change are written to.
    const desired = new Map<SVGGElement, number>()
    const mark = (path: number[] | undefined, bit: number) => {
      if (!path) return
      const group = findGroupByPath(path)
      if (group) desired.set(group, (desired.get(group) ?? 0) | bit)
    }
    for (const path of selectedPaths) mark(path, SELECTED)
    for (const entry of clipboard ?? []) mark(entry.path, CUT)
    for (const path of searchMatches) mark(path, SEARCH_HIT)
    mark(currentMatchPath(), SEARCH_CURRENT)
    for (const path of focused) mark(path, FOCUSED)

    for (const group of new Set([...highlighted, ...desired.keys()])) {
      const mask = desired.get(group) ?? 0
      for (const [bit, className] of HIGHLIGHT_CLASSES) {
        const want = (mask & bit) !== 0
        // Only write when the class has to change. markmap rewrites every
        // node's `class` on each render (which is why this runs again after
        // one), and a needless write would keep the observer busy forever.
        if (group.classList.contains(className) === want) continue
        group.classList.toggle(className, want)
      }
      if (mask === 0) highlighted.delete(group)
      else highlighted.add(group)
    }

    // Keep the connectors that lead into the focused nodes (from the cursor's
    // parent to the cursor, and from the cursor to its children) fully visible.
    // This is the one part that has to look at every connector, so it only runs
    // when the focused set changed — and not at all while focus mode is off.
    const focusKey = focused.length > 0 ? focused.map(pathKey).join('|') : ''
    if (focusKey !== focusLinksKey) {
      focusLinksKey = focusKey
      for (const link of focusLinks) link.classList.remove('advmm-focus-link')
      focusLinks = []
      if (focusKey !== '') {
        const wanted = new Set(focused.map(pathKey))
        for (const link of Array.from(svg.querySelectorAll<SVGPathElement>('path.markmap-link'))) {
          const target = (link as unknown as { __data__?: { target?: IPureNode } }).__data__?.target
          const path = target ? getSourcePath(target) : undefined
          if (!path || !wanted.has(pathKey(path))) continue
          link.classList.add('advmm-focus-link')
          focusLinks.push(link)
        }
      }
    }
    updateActionBar()
  }

  function commit(operation: EditOperation): Promise<void> | undefined {
    try {
      return applyChange(applyEdit(getMarkdown(), operation), operation.type === 'setText'
        ? [{ type: 'setText', path: operation.path }] : undefined)
    } catch (error) {
      handleEditError(error)
      return undefined
    }
  }

  /** Finds the rendered node whose source line is `line`. */
  function findGroupByLine(line: number): SVGGElement | null {
    return domIndex().byLine.get(line) ?? null
  }

  /** Finds the rendered node for a source path (survives re-renders). */
  function findGroupByPath(path: number[]): SVGGElement | null {
    return domIndex().byPath.get(pathKey(path)) ?? null
  }

  /** Visible node paths in source pre-order (folded/removed nodes are skipped). */
  function visiblePaths(): number[][] {
    const index = domIndex()
    const markdown = getMarkdown()
    if (visibleCache?.dom === index && visibleCache.markdown === markdown) return visibleCache.paths
    const rendered = new Set(index.byPath.keys())

    const paths = flattenPaths(sourceRoots()).filter(path => rendered.has(pathKey(path)))

    // The synthetic markmap root uses the empty path and is rendered first, so
    // `h` from any top-level node can reach it.
    if (rendered.has('')) paths.unshift([])
    visibleCache = { dom: index, markdown, paths }
    return paths
  }

  /**
   * Moves the cursor in `direction`. With `extend` (Shift held) the selection
   * grows from its anchor to the new cursor instead of collapsing.
   */
  function navigate(direction: Direction, extend = false) {
    if (!primaryPath) return

    const next = findNodeInDirection(visiblePaths(), primaryPath, direction)
    if (!next) {
      // `l` on a folded node reveals its first child instead of doing nothing.
      if (direction === 'right' && primaryNodeData()?.children?.length) {
        void revealFirstChild(primaryPath, extend)
      }
      return
    }

    if (!extend) {
      selectAndReveal(next)
      return
    }

    if (!anchorPath) anchorPath = primaryPath
    extendSelection(next)
    reveal(next)
  }

  /**
   * Expands the selected node one level (when folded) and moves the cursor to
   * its first child, so `l` can walk into a collapsed subtree. Only one level
   * is revealed: grandchildren and deeper stay folded.
   */
  async function revealFirstChild(path: number[], extend: boolean) {
    const data = primaryNodeData()
    if (!data?.children?.length) return
    if (data.payload?.fold) {
      if (revealChildren) await revealChildren(data)
      else await toggleFold?.(data)
    }

    const child = [...path, 0]
    if (!findGroupByPath(child)) return

    if (extend) {
      if (!anchorPath) anchorPath = path
      extendSelection(child)
      reveal(child)
    }
    else {
      selectAndReveal(child)
    }
  }

  /** Selects `path` and pans the mindmap so it is visible. */
  function selectAndReveal(path: number[]) {
    selectOnly(path)
    reveal(path)
  }

  /** Pans the mindmap so `path` is visible, without touching the selection. */
  function reveal(path: number[]) {
    const data = nodeDataAtPath(path)
    if (data) ensureVisible?.(data)
  }

  /** `Shift+M`: pans the view so the selected node sits in its center. */
  function centerSelected() {
    const data = primaryNodeData()
    if (data) void centerNode?.(data)
  }

  /**
   * Starts a zoom. One step is applied immediately so a quick tap always has a
   * visible effect; while the key stays down a `requestAnimationFrame` loop
   * keeps zooming smoothly, independent of the (slow) key auto-repeat rate.
   */
  function startZoom(action: ZoomAction) {
    // The selected node, or the whole content when nothing is selected: either
    // way the anchor is moved to the canvas center by `zoomBy`. The node's own
    // box travels along so it is clamped back on screen as we zoom in.
    const node = primaryPath ? primaryNodeData() : undefined
    const anchor = node ? getZoomAnchor?.(node) : getContentZoomAnchor?.()
    const keepVisible = node ? getZoomRect?.(node) : undefined
    zoomHold = { action, anchor, keepVisible }
    zoomBy?.(action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP, anchor, keepVisible)
    zoomLastTime = performance.now()
    if (zoomFrame === null) zoomFrame = window.requestAnimationFrame(stepZoom)
  }

  /** One animation frame of a held zoom. */
  function stepZoom(now: number) {
    zoomFrame = null
    const hold = zoomHold
    if (!hold) return

    // Clamp the frame time so a backgrounded tab (or a slow frame) cannot jump.
    const seconds = Math.min((now - zoomLastTime) / 1000, 0.1)
    zoomLastTime = now
    zoomBy?.(holdZoomFactor(seconds, hold.action === 'in'), hold.anchor, hold.keepVisible)
    zoomFrame = window.requestAnimationFrame(stepZoom)
  }

  /** Stops a held zoom (key released, focus lost or editor destroyed). */
  function stopZoom() {
    zoomHold = null
    if (zoomFrame !== null) {
      window.cancelAnimationFrame(zoomFrame)
      zoomFrame = null
    }
  }

  /**
   * `f`: toggles focus on the cursor and its direct children.
   * `F`: toggles focus on all siblings of the cursor.
   */
  function toggleFocus(siblings: boolean) {
    if (siblings) {
      siblingFocusMode = !siblingFocusMode
      if (siblingFocusMode) focusMode = false
    } else {
      focusMode = !focusMode
      if (focusMode) siblingFocusMode = false
    }
    applyHighlight()
  }

  function buildHelpOverlay(): HTMLDivElement | null {
    if (!container) return null
    const overlay = container.createDiv('advmm-help-overlay')
    const panel = overlay.createDiv('advmm-help-panel')
    panel.createDiv({ cls: 'advmm-help-title', text: strings.nodeEditor.help.title })
    for (const section of HELP_SECTIONS) {
      const group = panel.createDiv('advmm-help-section')
      group.createDiv({ cls: 'advmm-help-section-title', text: strings.nodeEditor.help.sections[section.id] })
      for (const entry of section.entries) {
        const row = group.createDiv('advmm-help-row')
        row.createEl('kbd', { cls: 'advmm-help-keys', text: entry.keys })
        row.createDiv({ cls: 'advmm-help-label', text: strings.nodeEditor.help.labels[entry.label] })
      }
    }
    panel.createDiv({ cls: 'advmm-help-close', text: strings.nodeEditor.help.closeHint })
    // A click on the dimmed backdrop dismisses the overlay.
    overlay.addEventListener('click', event => {
      if (event.target !== overlay) return
      event.preventDefault()
      hideHelp()
    })
    return overlay
  }

  /** `?`: shows the keyboard-shortcut overlay. */
  function showHelp() {
    if (!container) return
    pendingPrefix = null
    if (!helpOverlay) helpOverlay = buildHelpOverlay()
    helpOverlay?.removeClass('advmm-hidden')
    helpVisible = true
  }

  /** Hides the shortcut overlay (it is kept in the DOM for the next `?`). */
  function hideHelp() {
    helpOverlay?.addClass('advmm-hidden')
    helpVisible = false
  }

  function toggleHelp() {
    if (helpVisible) hideHelp()
    else showHelp()
  }

  /**
   * Node to start from when a navigation key is pressed with nothing selected:
   * the last selected node if it is still rendered, otherwise the node nearest
   * the center of the visible area, otherwise the first visible node.
   */
  function homePath(): number[] | undefined {
    if (lastPath && findGroupByPath(lastPath)) return lastPath

    const positions: NodePosition[] = []
    for (const group of groups()) {
      const path = sourcePathOf(group)
      // Skip the synthetic root: it is an empty render-only container and makes
      // a poor "home" node.
      if (!path || path.length === 0) continue
      const rect = group.getBoundingClientRect()
      positions.push({ path, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    }

    const view = (container ?? svg).getBoundingClientRect()
    const nearest = nearestPath(positions, view.left + view.width / 2, view.top + view.height / 2)
    const visible = visiblePaths()
    return nearest ?? visible.find(path => path.length > 0) ?? visible[0]
  }

  /** Data object backing the currently selected (primary) node. */
  function primaryNodeData(): IPureNode | undefined {
    if (!primaryPath) return undefined
    const group = findGroupByPath(primaryPath)
    if (!group) return undefined
    return (group as unknown as { __data__?: IPureNode }).__data__
  }

  /** Dispatches a resolved fold command. */
  function applyFoldAction(action: FoldAction) {
    // A selection that has been folded out of view must not swallow the
    // command: with nothing *rendered* selected, `zc`/`zC`/`zo`/`zO` act on the
    // whole tree (otherwise they would silently do nothing).
    const data = primaryNodeData()
    const hasSelection = !!data
    switch (action) {
      // With a node selected these act on it; otherwise they fold/unfold the
      // whole tree one level at a time.
      case 'fold':
        if (hasSelection) void foldSelected()
        else void runFoldCommand('foldLevel')
        return
      // `zC` mirrors `zo`: fold one level of the selected node's subtree, or of
      // the whole tree (the root's subtree) when nothing is selected.
      case 'foldLevel':
        void runFoldCommand('foldLevel', data as unknown as FoldNode | undefined)
        return
      case 'unfold':
        if (hasSelection) void revealSelectedOneLevel()
        else void runFoldCommand('unfoldLevel')
        return
      case 'unfoldAll':
        if (hasSelection) void revealSelectedAll()
        else void runFoldCommand('unfoldAll')
        return
      case 'toggleAll':
        void runFoldCommand('toggleAll')
        return
    }
  }

  /** `zc` / `zC` / `zo` / `zO` / `zA`: fold or unfold, level by level or whole. */
  async function runFoldCommand(action: FoldLevelAction, target?: FoldNode) {
    // `zC` passes the selected node, so its plan is relative to that subtree;
    // every other command works on the whole tree.
    const root = target ?? getFoldRoot?.()
    if (!root) return

    const plan = foldCommandPlan(root, action)
    if (!plan.fold.length && !plan.unfold.length) return

    if (applyFoldPlan) {
      await applyFoldPlan(plan)
      recenterAfterFold()
      return
    }

    // Fallback when no batch renderer is wired: toggle each node (one render each).
    for (const node of [...plan.fold, ...plan.unfold]) await toggleFold?.(node as IPureNode)
    recenterAfterFold()
  }

  /**
   * After a fold/unfold operation, pauses for the render transition to
   * complete before re-fitting. markmap's renderData() does not await its
   * d3 transitions, so calling fit immediately would overlap two animations
   * (node slides + viewport zoom), making the combined effect feel abrupt
   * instead of smooth.
   */
  function recenterAfterFold() {
    const duration = getAnimationDuration?.() ?? 500
    if (duration <= 0) {
      fitContent?.()
    } else {
      window.setTimeout(() => fitContent?.(), duration)
    }
  }

  /** Shows the keys that can follow `z`. */
  function showFoldHint() {
    if (!container) return
    if (!foldHint) foldHint = container.createDiv('advmm-key-hint advmm-hidden')
    foldHint.replaceChildren()
    for (const { key, action } of FOLD_HINTS) {
      const row = foldHint.createDiv('advmm-key-hint-row')
      row.createEl('kbd', { text: key })
      row.createSpan({ text: FOLD_HINT_LABELS[action] })
    }
    foldHint.removeClass('advmm-hidden')
  }

  function hideFoldHint() {
    foldHint?.addClass('advmm-hidden')
  }

  /**
   * Handles the `g` prefix sequence. When `g` is pressed, starts the
   * sequence; when `d` follows, jumps to the selected node's line in the
   * markdown source. Any other key resets the prefix.
   */
  function handleGoToDefSequence(key: string): boolean {
    if (pendingPrefix === GOTO_PREFIX) {
      pendingPrefix = null
      if (key === 'd' && primaryPath) goToDefinition(primaryPath)
      return true
    }
    if (key === GOTO_PREFIX) {
      pendingPrefix = GOTO_PREFIX
      return true
    }
    return false
  }

  /** Opens the markdown source at the line that produced the given node. */
  function goToDefinition(path: number[]) {
    if (!goToSourceLine) return
    const roots = sourceRoots()
    let node: SourceNode | undefined
    try {
      node = getNodeAtPath(roots, path)
    } catch {
      return
    }
    if (!node) return
    // `SourceNode.line` is 0-based. Convert to 1-based for the editor.
    goToSourceLine(node.line + 1)
  }

  // ---- search --------------------------------------------------------------

  /** Opens (or refocuses) the search bar and runs the current query. */
  function openSearch() {
    if (!container) return
    if (!searchBar) buildSearchBar()

    const input = searchInput
    if (!input) return

    searchActive = true
    pendingPrefix = null
    hideFoldHint()
    focusSearchInputAtEnd()
    // Focusing inside the keydown can be undone once the event finishes (the
    // view re-focuses its container, the IME activates, ...). Assert it again
    // on the next frame so the caret really stays in the query.
    window.requestAnimationFrame(() => {
      if (searchActive && searchEditing && !searchComposing && searchInput?.isConnected) focusSearchInputAtEnd()
    })
    runSearch(input.value)
  }

  /** Creates the query bar. Only ever called once, from `openSearch`. */
  function buildSearchBar() {
    if (!container) return

    searchBar = container.createDiv('advmm-search-bar')
    const input = searchBar.createEl('input', { cls: 'advmm-search-input' })
    input.type = 'text'
    input.placeholder = strings.nodeEditor.searchPlaceholder
    input.value = lastSearchQuery
    input.addEventListener('input', () => runSearch(input.value))
    input.addEventListener('keydown', onSearchInputKeyDown)
    // An IME (fcitx5/rime, ...) types through a composition: `compositionstart`
    // opens the preedit and `compositionend` commits it. While the composition
    // is open nothing may move the caret or clear the DOM selection, otherwise
    // the IME state is lost and the input swallows every further keystroke.
    input.addEventListener('compositionstart', () => { searchComposing = true })
    input.addEventListener('compositionend', () => {
      searchComposing = false
      runSearch(input.value)
      if (searchActive && searchEditing) focusSearchInputAtEnd()
    })
    // Focus can be pulled away after any keystroke (Obsidian re-focusing its
    // view, the IME, a re-render, ...). As long as the user has not clicked
    // elsewhere, hand the caret straight back so the query keeps receiving keys.
    input.addEventListener('focusout', () => {
      if (!searchActive || !searchEditing || searchComposing) return
      window.requestAnimationFrame(() => {
        if (searchActive && searchEditing && !searchComposing && input.isConnected) focusSearchInputAtEnd()
      })
    })
    searchInput = input
    searchCount = searchBar.createSpan({ cls: 'advmm-search-count' })
    searchBar.createSpan({ cls: 'advmm-search-hint', text: strings.nodeEditor.searchHint })
  }

  /** Closes the search bar and clears the search highlighting. */
  function closeSearch() {
    searchActive = false
    searchEditing = false
    searchComposing = false
    searchQuery = ''
    searchMatches = []
    searchIndex = 0
    searchBar?.remove()
    searchBar = null
    searchInput = null
    searchCount = null
    applyHighlight()
  }

  /** Recomputes the matches for `query` without moving the selection. */
  function runSearch(query: string) {
    searchQuery = query
    if (!isQueryEmpty(query)) lastSearchQuery = query
    const roots = sourceRoots()
    if (!sourceCache!.searchNodes) sourceCache!.searchNodes = collectSearchNodes(roots)
    searchMatches = isQueryEmpty(query)
      ? []
      : findMatches(sourceCache!.searchNodes, query)
    searchIndex = 0
    applyHighlight()
    updateSearchCount()
  }

  function currentMatchPath(): number[] | undefined {
    return searchMatches[searchIndex]
  }

  function updateSearchCount() {
    if (!searchCount) return

    if (isQueryEmpty(searchQuery)) searchCount.textContent = ''
    else if (searchMatches.length === 0) searchCount.textContent = strings.nodeEditor.searchNoResults
    else searchCount.textContent = `${searchIndex + 1}/${searchMatches.length}`
  }

  /** Moves the search cursor by `delta` (wrapping) and shows the match. */
  function goToMatch(delta: number) {
    if (searchMatches.length === 0) return

    searchIndex = stepIndex(searchIndex, searchMatches.length, delta)
    showMatch()
  }

  /**
   * `Enter`: leave the input, hand the keyboard back to the mindmap and locate
   * the first match. `n`/`p` then step through the remaining matches.
   */
  function confirmSearch() {
    searchEditing = false
    searchInput?.blur()
    container?.focus()
    searchIndex = 0
    showMatch()
  }

  /** Focuses the query input and puts the caret at the end of the text. */
  function focusSearchInputAtEnd() {
    const input = searchInput
    if (!input) return

    searchEditing = true
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
  }

  /** Hands the keyboard back to the query and appends `text` to it. */
  function appendToSearchQuery(text: string) {
    const input = searchInput
    if (!input) return

    input.value += text
    focusSearchInputAtEnd()
    runSearch(input.value)
  }

  /**
   * Selects the current match immediately (so the highlight lands this frame)
   * and then unfolds/pans to it asynchronously.
   */
  function showMatch() {
    const path = currentMatchPath()
    if (!path) return

    selectOnly(path)
    applyHighlight()
    updateSearchCount()
    void followMatch(path)
  }

  /** Unfolds and pans to `path`, which may be hidden inside a folded subtree. */
  async function followMatch(path: number[]) {
    await revealSearchPath(path)
    // `ensureVisible` only nudges the viewport to the node's nearest edge, which
    // can leave it hanging off the side of the canvas (and barely visible for a
    // wide node). Centering it — with the same keep-visible clamp as `Shift+M`
    // and the zoom keys — guarantees the match is really on screen.
    const data = nodeDataAtPath(path)
    if (data && centerNode) void centerNode(data)
    else reveal(path)
    applyHighlight()
  }

  /** The rendered data of the node at `path`, if it is currently visible. */
  function nodeDataAtPath(path: number[]): IPureNode | undefined {
    const group = findGroupByPath(path)
    return group ? (group as unknown as { __data__?: IPureNode }).__data__ : undefined
  }

  /** Unfolds the ancestors of `path` so that a folded match becomes visible. */
  async function revealSearchPath(path: number[]) {
    const root = getFoldRoot?.()
    if (!root) return

    let node: FoldNode | undefined = root
    for (let i = 0; i < path.length; i++) {
      const child = node?.children?.[path[i]] as FoldNode | undefined
      if (!child) return

      // Reveal a parent whose children are hidden; the match itself only needs
      // to be visible, not expanded.
      if (i < path.length - 1 && child.payload?.fold) {
        if (revealChildren) await revealChildren(child as unknown as IPureNode)
        else await toggleFold?.(child as unknown as IPureNode)
      }
      node = child
    }
  }

  /** Keys handled by the search input itself (while it owns the keyboard). */
  function onSearchInputKeyDown(event: KeyboardEvent) {
    handleSearchKey(event, true)
  }

  /**
   * Keys handled while the search bar is open. `edit` is true while the query
   * input owns the keyboard. Returns `true` when the key was consumed.
   *
   * While editing, plain characters are left to the browser (they type into the
   * input natively) — unless the event did not come from the input, which means
   * focus was pulled out from under it; then the character is appended here so
   * typing is never lost. In navigate mode an unhandled key closes the search.
   */
  function handleSearchKey(event: KeyboardEvent, edit: boolean): boolean {
    // An IME (Chinese, Japanese, ...) uses Enter and the arrow keys to pick a
    // candidate and reports those keystrokes with `isComposing` (or keyCode
    // 229); they belong to the IME, not to the search navigation.
    if (event.isComposing) return false

    const consume = () => {
      event.preventDefault()
      event.stopPropagation()
    }

    if (event.ctrlKey && (event.key === 'n' || event.key === 'p')) {
      consume()
      goToMatch(event.key === 'n' ? 1 : -1)
      return true
    }

    if (event.key === 'Escape') {
      consume()
      closeSearch()
      container?.focus()
      return true
    }

    if (event.key === 'Enter') {
      consume()
      if (edit) confirmSearch()
      else goToMatch(1)
      return true
    }

    if (event.key === 'ArrowDown') {
      consume()
      goToMatch(1)
      return true
    }

    if (event.key === 'ArrowUp') {
      consume()
      goToMatch(-1)
      return true
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return false

    // `n`/`p` only navigate once editing has stopped: while typing they are
    // ordinary letters and must reach the input.
    if (!edit) {
      if (event.key === '/') {
        consume()
        focusSearchInputAtEnd()
        return true
      }
      if (event.key === 'n') {
        consume()
        goToMatch(1)
        return true
      }
      if (event.key === 'N' || event.key === 'p') {
        consume()
        goToMatch(-1)
        return true
      }
    }

    if (event.key.length !== 1) return false

    if (edit) {
      // The key already came from the input: let the browser type it.
      if (event.target === searchInput) return false
      consume()
      appendToSearchQuery(event.key)
      return true
    }

    closeSearch()
    return false
  }

  /**
   * Safety net for the query input losing focus (Obsidian re-focusing its view,
   * the IME, a re-render, ...). Capture on the document so the keystroke is
   * routed into the query before anything else can act on it.
   */
  function onDocumentKeyDown(event: KeyboardEvent) {
    if (!searchActive) return
    // A stale editor (re-rendered, another pane) must not hijack the keys.
    if (!searchBar?.isConnected) return
    // `event.target` is realm-safe (an Obsidian pop-out window has its own
    // `document`): when the key really came from the input, its own listener
    // handles it.
    if (event.target === searchInput) return
    // Several mindmaps share the same `document`, each with its own capture
    // listener. A key typed into another mindmap's editor (or its search bar)
    // must not drive this one's search.
    const target = event.target as Node | null
    if (target && typeof (target as Element).closest === 'function' && (target as Element).closest('.advmm-editor-container') !== container) return
    handleSearchKey(event, searchEditing)
  }

  /** `zc`: collapse the selected node without a source edit. */
  async function foldSelected() {
    const data = primaryNodeData()
    if (!data?.children?.length) return
    if (data.payload?.fold) return

    await toggleFold?.(data)
    updateActionBar()
    recenterAfterFold()
  }

  /** `zo`: reveal one more level below the selected node (display only). */
  async function revealSelectedOneLevel() {
    const data = primaryNodeData()
    if (!data?.children?.length) return

    // Progressive: each `zo` walks one level deeper instead of opening the
    // whole subtree at once.
    const plan = revealNextLevelPlan(data as unknown as FoldNode)
    if (!plan.fold.length && !plan.unfold.length) return

    if (applyFoldPlan) {
      await applyFoldPlan(plan)
      updateActionBar()
      recenterAfterFold()
      return
    }

    // Fallback when no batch renderer is wired: reveal exactly one level.
    if (revealChildren) await revealChildren(data)
    else await toggleFold?.(data)
    updateActionBar()
    recenterAfterFold()
  }

  /** `zO`: reveal every descendant of the selected node (display only). */
  async function revealSelectedAll() {
    const data = primaryNodeData()
    if (!data?.children?.length) return

    if (revealAllChildren) await revealAllChildren(data)
    else await toggleFold?.(data)
    updateActionBar()
    recenterAfterFold()
  }

  /** Records `next` in the undo history and writes it to the source. */
  async function applyChange(next: string, edits?: TreeEdit[]): Promise<void> {
    const current = getMarkdown()
    if (current === next) return

    // The document changed outside the editor, so the history is stale.
    if (lastWritten !== null && current !== lastWritten) {
      undoStack.length = 0
      redoStack.length = 0
    }

    undoStack.push(current)
    if (undoStack.length > MAX_HISTORY) undoStack.shift()
    redoStack.length = 0
    lastWritten = next

    if (edits) onSourceChange?.(current, next, edits)
    await setMarkdown(next)
    updateActionBar()
  }

  /** Find the first node restored/changed when going from `before` to `after`. */
  function findRestoredPath(before: string, after: string): number[] | null {
    const beforeRoots = parseSource(before)
    const afterRoots = parseSource(after)
    const beforeFlat = flattenPaths(beforeRoots)
    const afterFlat = flattenPaths(afterRoots)
    const beforePathKeys = new Set(beforeFlat.map(pathKey))

    const nodeCountBefore = beforeFlat.length
    const nodeCountAfter = afterFlat.length

    const safeText = (roots: SourceNode[], path: number[]) => {
      try { return getNodeAtPath(roots, path).text } catch { return undefined }
    }

    if (nodeCountAfter >= nodeCountBefore) {
      // Nodes were added or unchanged — focus the first genuinely new or
      // text-changed node.
      const beforeTexts = new Set(beforeFlat.map(p => safeText(beforeRoots, p)).filter(Boolean))
      // Priority 1: genuinely new node (new path + new text).
      for (const path of afterFlat) {
        if (!beforePathKeys.has(pathKey(path))) {
          const text = safeText(afterRoots, path)
          if (text !== undefined && !beforeTexts.has(text)) return path
        }
      }
      // Priority 2: same path, different text.
      for (const path of afterFlat) {
        if (beforePathKeys.has(pathKey(path)) && safeText(beforeRoots, path) !== safeText(afterRoots, path)) return path
      }
      // Priority 3: shifted node.
      for (const path of afterFlat) {
        if (!beforePathKeys.has(pathKey(path))) return path
      }
      // Absolute fallback.
      return afterFlat[0] ?? null
    }

    // Nodes were removed — focus the parent of the first removed position.
    // Walk both flattened trees in parallel: the first position where texts
    // differ is where a node was removed (its slot was taken by the next node).
    const maxLen = Math.min(beforeFlat.length, afterFlat.length)
    let removedIdx = -1
    for (let i = 0; i < maxLen; i++) {
      if (safeText(beforeRoots, beforeFlat[i]) !== safeText(afterRoots, afterFlat[i])) {
        removedIdx = i
        break
      }
    }
    if (removedIdx < 0) removedIdx = maxLen // trailing nodes were removed
    const removedPath = beforeFlat[removedIdx]
    if (removedPath) {
      const anchor = [...removedPath]
      anchor.pop()
      if (anchor.length > 0) {
        try { getNodeAtPath(afterRoots, anchor); return anchor } catch { /* empty */ }
      }
      // Parent doesn't exist or is the synthetic root — try the same index in after.
      try { getNodeAtPath(afterRoots, removedPath); return removedPath } catch { /* empty */ }
    }
    return afterFlat[0] ?? null
  }

  async function undo() {
    const previous = undoStack.pop()
    if (previous === undefined) return

    const current = getMarkdown()
    redoStack.push(current)
    lastWritten = previous
    // Undoing may restore a cut node, so drop the pending paste to avoid dupes.
    clipboard = null
    await setMarkdown(previous)
    const restored = findRestoredPath(current, previous)
    selectOnly(restored)
    container?.focus()
  }

  async function redo() {
    const next = redoStack.pop()
    if (next === undefined) return

    const current = getMarkdown()
    undoStack.push(current)
    lastWritten = next
    clipboard = null
    await setMarkdown(next)
    const restored = findRestoredPath(current, next)
    selectOnly(restored)
    container?.focus()
  }

  /** Runs a Ctrl/Cmd shortcut. Returns `false` when it does not apply here. */
  function runClipboardCommand(command: ClipboardCommand): boolean {
    switch (command) {
      case 'undo':
        // A pending cut is cancelled first, before undoing the last edit.
        if (clipboard) {
          clipboard = null
          applyHighlight()
          return true
        }
        void undo()
        return true
      case 'redo':
        void redo()
        return true
      case 'cut': {
        // The synthetic root (`[]`) is not part of the document and cannot be cut.
        const editable = selectedPaths.filter(path => path.length > 0)
        if (editable.length === 0) return false
        cutNode(editable)
        return true
      }
      case 'paste':
        if (!clipboard || !primaryPath || primaryPath.length === 0) return false
        void pasteInto(primaryPath)
        return true
    }
  }

  /** `Ctrl+X`: marks the nodes so they can be moved with `Ctrl+V`. */
  function cutNode(paths: number[][]) {
    const tree = sourceRoots()
    const entries: { path: number[]; text: string }[] = []
    for (const path of paths) {
      try {
        entries.push({ path, text: getNodeAtPath(tree, path).text })
      } catch {
        return
      }
    }
    if (entries.length === 0) return

    clipboard = entries
    applyHighlight()
    container?.focus()
    new Notice(strings.nodeEditor.cutDone)
  }

  /** Drag-and-drop: moves `source` next to or inside `target`. */
  async function moveTo(source: number[], target: DropTarget) {
    const result = moveNode(getMarkdown(), source, target.path, target.position)
    if (result.line < 0) {
      new Notice(strings.nodeEditor.moveInvalid)
      return
    }

    try {
      // The move is one remove + one insert, so the renderer can reuse every
      // other node (and their fold state) instead of rebuilding the tree.
      const dest = pathAtLine(parseSource(result.markdown), result.line)
      await applyChange(result.markdown, dest
        ? [{ type: 'remove', path: source }, { type: 'insert', path: dest }]
        : undefined)
    } catch (error) {
      handleEditError(error)
      return
    }

    const group = findGroupByLine(result.line)
    const path = group && sourcePathOf(group)
    selectOnly(path ?? null)
    container?.focus()
  }

  /** `J`/`K`: moves the primary node one sibling position down/up. */
  async function reorderSelection(offset: number) {
    const path = primaryPath
    if (!path || path.length === 0) return

    const parentPath = path.slice(0, -1)
    const index = path[path.length - 1]
    const targetIndex = index + offset
    const tree = sourceRoots()
    const siblings = parentPath.length === 0 ? tree : getNodeAtPath(tree, parentPath).children
    if (targetIndex < 0 || targetIndex >= siblings.length) return

    const targetPath = [...parentPath, targetIndex]
    const result = moveNode(getMarkdown(), path, targetPath, offset < 0 ? 'before' : 'after')
    if (result.line < 0) {
      new Notice(strings.nodeEditor.moveInvalid)
      return
    }

    try {
      // A sibling swap is a remove + insert at the known destination path.
      await applyChange(result.markdown, [
        { type: 'remove', path },
        { type: 'insert', path: targetPath },
      ])
    } catch (error) {
      handleEditError(error)
      return
    }

    // A sibling swap has a known destination path. Source lines are not unique
    // in markmap: the synthetic root can share a line with the first item, so
    // a line lookup may select the root depending on DOM order.
    selectOnly(targetPath)
    container?.focus()
  }

  /**
   * Where a code block or table must be dropped. They have no children in
   * markmap (a `<pre>`/`<table>` is a leaf), so a drop onto one targets the
   * node it belongs to instead. Returns `null` for a top-level block, which
   * has no valid parent to fall back to.
   */
  function childTargetPath(path: number[]): number[] | null {
    let current = path
    while (current.length > 0) {
      if (!isOpaqueBlock(current)) return current
      current = current.slice(0, -1)
    }
    return null
  }

  /** True when the node at `path` is a code block or table. */
  function isOpaqueBlock(path: number[]): boolean {
    const group = findGroupByPath(path)
    const tag = (group as unknown as { __data__?: IPureNode } | null)?.__data__?.payload?.tag
    return tag === 'pre' || tag === 'table'
  }

  /** Viewport boxes of every rendered node, keyed by its source path. */
  function collectDropBoxes(): DropBox[] {
    const index = domIndex()
    if (dropBoxCache?.dom === index) return dropBoxCache.boxes
    const boxes: DropBox[] = []
    for (const group of index.nodes) {
      const path = sourcePathOf(group)
      if (!path) continue
      const rect = group.getBoundingClientRect()
      boxes.push({ path, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }
    dropBoxCache = { dom: index, boxes }
    return boxes
  }

  /** Path of the node the browser reports under `(x, y)`, if any. */
  function hoveredPathAt(x: number, y: number): number[] | null {
    const group = findAnyNodeGroup(document.elementFromPoint(x, y))
    return group ? sourcePathOf(group) ?? null : null
  }

  /** Where a drop at `(x, y)` lands: a child target or a sibling position. */
  function dropPositionAt(x: number, y: number): DropTarget | null {
    if (!drag) return null

    const target = resolveDropTarget(x, y, collectDropBoxes(), drag.path, hoveredPathAt(x, y))
    if (!target || target.path.length === 0) return null
    if (target.position === 'child') {
      const child = childTargetPath(target.path)
      return child ? { position: 'child', path: child } : null
    }
    return target
  }

  /** Geometry of the insertion line for a `before` / `after` drop. */
  function dropLineGeometry(target: DropTarget, boxes: DropBox[]): { x: number; y: number; width: number } | null {
    const box = boxes.find(candidate => samePath(candidate.path, target.path))
    if (!box) return null

    let y = target.position === 'before' ? box.top : box.bottom
    if (target.position === 'after') {
      for (const candidate of boxes) {
        if (isDescendantPath(target.path, candidate.path)) y = Math.max(y, candidate.bottom)
      }
    }
    return { x: box.left, y, width: Math.max(box.right - box.left, 8) }
  }

  function setDropTarget(target: DropTarget | null) {
    if (sameDropTarget(dropTarget, target)) return
    dropTarget = target

    for (const group of groups()) {
      const current = sourcePathOf(group)
      const isTarget = target?.position === 'child' && !!current && samePath(current, target.path)
      group.classList.toggle('advmm-drop-target', isTarget)
    }

    if (dropLine) {
      dropLine.remove()
      dropLine = null
    }
    if (target && target.position !== 'child') {
      const geometry = dropLineGeometry(target, collectDropBoxes())
      if (geometry) {
        dropLine = createDiv()
        dropLine.addClass('advmm-drop-line')
        dropLine.setCssStyles({
          left: `${geometry.x}px`,
          top: `${geometry.y}px`,
          width: `${geometry.width}px`,
        })
        document.body.appendChild(dropLine)
      }
    }
  }

  /** `Ctrl+V`: moves the marked subtree to become a child of `targetPath`. */
  async function pasteInto(targetPath: number[]) {
    const cut = clipboard
    if (!cut) return

    // The marked nodes may have been edited or removed since they were cut.
    if (!cut.every(entry => nodeMatches(entry.path, entry.text))) {
      clipboard = null
      applyHighlight()
      new Notice(strings.nodeEditor.pasteInvalid)
      return
    }

    const target = childTargetPath(targetPath)
    if (!target) {
      new Notice(strings.nodeEditor.pasteInvalid)
      return
    }

    const result = moveNodes(getMarkdown(), cut.map(entry => entry.path), target, 'child')
    if (result.line < 0) {
      new Notice(strings.nodeEditor.pasteInvalid)
      return
    }

    try {
      // Single-node paste is a remove + insert; multi-node paste still falls
      // back to a full re-render until its destination paths are computed.
      const dest = cut.length === 1
        ? pathAtLine(parseSource(result.markdown), result.line)
        : undefined
      await applyChange(result.markdown, dest
        ? [{ type: 'remove', path: cut[0].path }, { type: 'insert', path: dest }]
        : undefined)
    } catch (error) {
      handleEditError(error)
      return
    }

    clipboard = null

    const group = findGroupByLine(result.line)
    const path = group && sourcePathOf(group)
    selectOnly(path ?? null)
    container?.focus()
  }

  /** True when the node at `path` still holds `text` (validates a pending cut). */
  function nodeMatches(path: number[], text: string): boolean {
    try {
      return getNodeAtPath(sourceRoots(), path).text === text
    } catch {
      return false
    }
  }

  function openTextEditor(
    group: SVGGElement | null,
    path: number[],
    text = sourceText(path),
    select: 'all' | 'end' = 'all',
    // Resolves the DOM node to position the input over. Used for a freshly
    // added node, which may not be rendered yet; `group` is the fallback.
    resolve?: () => SVGGElement | null,
    trackDuration = getAnimationDuration?.() ?? 0,
    // Called right before `cancel` so cleanup (e.g. restoring hidden groups)
    // happens before the cursor is moved.
    onCancel?: () => void,
  ) {
    if (text === undefined) return

    const rename = (value: string) => void saveText(path, value)
    const cancel = () => {
      onCancel?.()
      selectOnly(path)
      container?.focus()
    }

    openInlineInput(
      text,
      () => {
        // Measure the visible node box, not the surrounding <g>: its bounding
        // box also covers the connector line and fold circle, which are offset
        // from the text and scale with the zoom level.
        const current = resolve ? resolve() : (findGroupByPath(path) ?? group)
        if (!current) return { left: 0, top: 0, width: 0, height: 0, trustWidth: false }
        const target = nodeContentElement(current)
        const rect = target.getBoundingClientRect()
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          maxWidth: nodeMaxWidth(current),
          ...nodeMetrics(target, current),
          // The anchor's box only says where the input starts: until the new
          // node is rendered, its width has nothing to do with the text being
          // edited. Once the node itself is on screen, cover its box exactly as
          // a normal edit does - markmap can draw a node wider than its source
          // text (ordered lists render `43. New node`), and an input sized to
          // the text alone leaves the node's tail sticking out behind it.
          trustWidth: !resolve || current !== group,
          // Hide the node's own text while the input stands in for it, so the
          // two copies can never show at once (see `Rect.mask`).
          mask: current.querySelector('.markmap-foreign'),
        }
      },
      // On mobile the on-screen keyboard has no Tab/Enter editing affordances:
      // every key just saves the new name (blur saves too, so nothing is lost).
      Platform.isMobile
        ? { save: rename, commit: rename, addChild: rename, cancel }
        : {
            save: rename,
            commit: value => void saveAndSelect(path, value),
            addChild: value => void saveThenAdd(path, value, 'addChild'),
            cancel,
          },
      { track: true, trackDuration, select, observe: svg },
    )
  }

  /** `i`: edit the selected node with the caret at the end of its text. */
  function editSelected() {
    if (!primaryPath) return
    const group = findGroupByPath(primaryPath)
    if (group) openTextEditor(group, primaryPath, undefined, 'end')
  }

  async function saveText(path: number[], text: string) {
    // Empty nodes are not allowed: clearing the text keeps the previous content
    // (delete the node explicitly with Backspace to remove it).
    if (text.trim() === '') {
      selectOnly(path)
      container?.focus()
      return
    }

    // Select immediately so the user sees instant visual feedback (highlight
    // + focus); the render and animation run asynchronously afterwards.
    selectOnly(path)
    await commit({ type: 'setText', path, text })
  }

  /** Saves the text, then selects the node so the next Enter adds a sibling. */
  async function saveAndSelect(path: number[], text: string) {
    await saveText(path, text)
    container?.focus()
  }

  /**
   * Where a just-inserted child/sibling lands. `applyEdit` splices the new node
   * right after `node.endLine`, i.e. as the last child (`addChild`) or as the
   * next sibling (`addSibling`).
   */
  function pathForNewNode(node: SourceNode, path: number[], type: 'addChild' | 'addSibling'): number[] {
    return type === 'addChild'
      ? [...path, node.children.length]
      : [...path.slice(0, -1), path[path.length - 1] + 1]
  }

  /** The rendered group of `path`, or the first node when it is not found. */
  function anchorGroup(path: number[]): SVGGElement | null {
    return findGroupByPath(path) ?? groups()[0] ?? null
  }

  /** Reports a failed edit: logs the cause and tells the user nothing changed. */
  function handleEditError(error: unknown) {
    console.error(error)
    new Notice(strings.nodeEditor.error)
  }

  /**
   * Opens the inline editor on a freshly added node *immediately*, without
   * waiting for the (async) re-render or the disk write. The input is placed
   * over the node as soon as markmap renders it; until then it sits over the
   * node the new one is attached to (`anchor`).
   */
  function editNewNode(anchor: SVGGElement | null, line: number, path: number[]) {
    // `line` may currently belong to an existing node (the new node shifts the
    // following lines down). Remember the groups that already exist so the
    // input only snaps to the freshly rendered one.
    const known = new Set(groups())
    selectOnly(path)
    openTextEditor(
      anchor,
      path,
      strings.nodeEditor.newNode,
      'all',
      () => {
        // The path is exact, the line is the fallback (an inserted sibling keeps
        // its line even though the paths of the nodes below it shift).
        const byPath = findGroupByPath(path)
        if (byPath && !known.has(byPath)) return byPath
        const byLine = findGroupByLine(line)
        return byLine && !known.has(byLine) ? byLine : anchor
      },
    )
  }

  /** Saves the edited text, then adds a child/sibling and edits it. */
  function saveThenAdd(path: number[], text: string, type: 'addChild' | 'addSibling') {
    try {
      let markdown = getMarkdown()
      // Empty nodes are not allowed; an empty edit keeps the previous text.
      if (text.trim() !== '')
        markdown = applyEdit(markdown, { type: 'setText', path, text })

      const node = getNodeAtPath(parseSource(markdown), path)
      const anchor = anchorGroup(path)
      const newPath = pathForNewNode(node, path, type)
      const newLine = node.endLine + 1

      const next = applyEdit(markdown, { type, path, text: strings.nodeEditor.newNode })
      void applyChange(next, [
        ...(text.trim() !== '' ? [{ type: 'setText' as const, path }] : []),
        { type: 'insert', path: newPath },
      ]).catch(handleEditError)

      editNewNode(anchor, newLine, newPath)
    } catch (error) {
      handleEditError(error)
    }
  }

  /** Adds a node with a placeholder and opens the inline editor on it. */
  function addNode(path: number[], type: 'addChild' | 'addSibling') {
    try {
      const markdown = getMarkdown()
      const anchor = anchorGroup(path)

      let newPath: number[]
      let newLine: number

      if (path.length === 0) {
        // The synthetic root has no source node: the new node is appended as a
        // new top-level node (see `applyEdit`).
        const target = rootChildTarget(markdown)
        newPath = target.path
        newLine = target.line
      }
      else {
        // The tree of the markdown this render was built from: parsing it again
        // here would scan the whole document a second time per added node.
        const node = getNodeAtPath(sourceRoots(), path)
        newPath = pathForNewNode(node, path, type)
        newLine = node.endLine + 1
      }

      const next = applyEdit(markdown, { type, path, text: strings.nodeEditor.newNode })
      void applyChange(next, [{ type: 'insert', path: newPath }]).catch(handleEditError)

      editNewNode(anchor, newLine, newPath)
    } catch (error) {
      handleEditError(error)
    }
  }

  async function removeSelection() {
    // The synthetic root is render-only and cannot be removed.
    await removePaths(selectedPaths.filter(path => path.length > 0))
  }

  async function removePaths(paths: number[][]) {
    if (paths.length === 0) return
    try {
      const anchorPath = paths[0]
      await applyChange(removeSourceNodes(getMarkdown(), paths),
        paths.map(path => ({ type: 'remove' as const, path })))
      // Focus the sibling that replaced the first deleted node; if none, try
      // the previous sibling; if that level is empty, focus the parent.
      const target = [...anchorPath]
      let resolved = false
      // Same position: the next sibling shifted into the deleted node's slot.
      try { getNodeAtPath(sourceRoots(), target); resolved = true } catch { /* empty */ }
      if (!resolved && target[target.length - 1] > 0) {
        // No node at this position — try the previous sibling.
        target[target.length - 1]--
        try { getNodeAtPath(sourceRoots(), target); resolved = true } catch { /* empty */ }
      }
      if (!resolved) {
        target.pop()
        if (target.length > 0) {
          try { getNodeAtPath(sourceRoots(), target); resolved = true } catch { /* empty */ }
        }
      }
      selectOnly(resolved ? target : null)
      container?.focus()
    } catch (error) {
      handleEditError(error)
    }
  }

  function openMenu(event: MouseEvent, group: SVGGElement, path: number[]) {
    const menu = new Menu()
    menu
      .addItem(item => item
        .setTitle(strings.nodeEditor.edit)
        .setIcon('pencil')
        .onClick(() => openTextEditor(group, path)))
      .addItem(item => item
        .setTitle(strings.nodeEditor.addChild)
        .setIcon('indent')
        .onClick(() => void addNode(path, 'addChild')))
      .addItem(item => item
        .setTitle(strings.nodeEditor.addSibling)
        .setIcon('outdent')
        .onClick(() => void addNode(path, 'addSibling')))
      .addSeparator()
      .addItem(item => item
        .setTitle(strings.nodeEditor.cut)
        .setIcon('scissors')
        .onClick(() => {
          if (!selectedPaths.some(selected => samePath(selected, path))) selectOnly(path)
          cutNode(selectedPaths)
        }))
      .addItem(item => item
        .setTitle(strings.nodeEditor.fold)
        .setIcon('chevrons-down-up')
        .onClick(() => {
          selectOnly(path)
          void foldSelected()
        }))
      .addItem(item => item
        .setTitle(strings.nodeEditor.unfold)
        .setIcon('chevrons-up-down')
        .onClick(() => {
          selectOnly(path)
          void revealSelectedOneLevel()
        }))
      .addItem(item => item
        .setTitle(strings.nodeEditor.unfoldAll)
        .setIcon('chevrons-down')
        .onClick(() => {
          selectOnly(path)
          void revealSelectedAll()
        }))

    if (nodeWidth(group, getNodeWidths?.() ?? {}) !== undefined) {
      menu.addItem(item => item
        .setTitle(strings.nodeEditor.resetWidth)
        .setIcon('move-horizontal')
        .onClick(() => resetWidth(path)))
    }

    menu
      .addSeparator()
      .addItem(item => item
        .setTitle(strings.nodeEditor.remove)
        .setIcon('trash')
        .onClick(() => {
          // The node under the pointer may be one of several selected nodes:
          // then the whole selection goes, exactly as Backspace removes it.
          if (!selectedPaths.some(selected => samePath(selected, path))) selectOnly(path)
          void removeSelection()
        }))

    if (clipboard) {
      menu.addSeparator()
      menu.addItem(item => item
        .setTitle(strings.nodeEditor.paste)
        .setIcon('clipboard-paste')
        .onClick(() => void pasteInto(path)))
    }

    if (goToSourceLine) {
      menu.addSeparator()
      menu.addItem(item => item
        .setTitle(strings.nodeEditor.goToDefinition)
        .setIcon('file-search')
        .onClick(() => goToDefinition(path)))
    }

    menu.showAtMouseEvent(event)
  }
}

