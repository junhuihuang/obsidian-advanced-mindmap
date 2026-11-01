import type { INode } from 'markmap-common'
import type { Markmap } from 'markmap-view'
import type { TreeChangeListener } from './tree-updater'

import { attachNodeEditor, type NodeEditorHandle } from 'src/editing/node-editor'
import type { NodeWidths } from 'src/settings/filesystem'
import { recenterOnCircleClick } from './fold-click'
import { applyFoldPlan, centerSubtree, contentZoomAnchor, unfoldAllLevels, unfoldOneLevel, zoomAnchor, zoomMarkmap, zoomRect } from './renderer-common'


/** The renderer-specific pieces of the editor; everything else comes from the markmap. */
export interface MindmapEditorContext {
  svg: SVGSVGElement
  /** Returns the markdown the current render was built from. */
  getMarkdown: () => string
  /** Returns the parsed source tree for the current render. */
  getSourceRoots?: () => import('src/editing/source-tree').SourceNode[]
  /** Persists edited markdown and updates the affected node data/labels. */
  setMarkdown: (markdown: string) => void | Promise<void>
  /** Per-node widths of the note (stored in the plugin data, not the markdown). */
  getNodeWidths: () => NodeWidths
  /** Persists one node's width (`null` clears it); returns whether it changed. */
  setNodeWidth: (key: string, width: number | null) => boolean
  onSourceChange?: TreeChangeListener
  /** Duration (ms) of the markmap position animation. */
  getAnimationDuration: () => number
  /** Opens the markdown source at the given line (1-based). */
  goToSourceLine?: (line: number) => void
}

/**
 * Attaches outliner-style editing to a rendered markmap.
 *
 * Both the tab and the code-block renderer need exactly the same behaviour, so
 * the markmap-backed callbacks (centering, zooming, folding) are wired here once
 * instead of being repeated per renderer. A fold-circle click is also routed
 * through the same re-centering the keyboard fold commands use.
 */
export function createMindmapEditor(
  markmap: Markmap,
  { svg, getMarkdown, getSourceRoots, setMarkdown, getNodeWidths, setNodeWidth, onSourceChange, getAnimationDuration, goToSourceLine }: MindmapEditorContext,
): NodeEditorHandle {
  // While a node is resized by dragging its edge, markmap must not animate
  // every layout step over `duration` ms: the box would chase the pointer with
  // a 500 ms delay. Zero for the gesture, restored on release.
  let savedDuration: number | null = null

  const editor = attachNodeEditor({
    svg,
    getMarkdown,
    getSourceRoots,
    setMarkdown,
    getNodeWidths,
    setNodeWidth,
    onSourceChange,
    getAnimationDuration,
    ensureVisible: node => void markmap.ensureVisible(node as INode),
    centerNode: node => void centerSubtree(markmap, node as INode),
    getZoomAnchor: node => zoomAnchor(markmap, node as INode),
    getZoomRect: node => zoomRect(markmap, node as INode),
    getContentZoomAnchor: () => contentZoomAnchor(markmap),
    zoomBy: (factor, anchor, keepVisible) => zoomMarkmap(markmap, factor, anchor, keepVisible),
    toggleFold: node => markmap.toggleNode(node as INode),
    revealChildren: node => unfoldOneLevel(markmap, node as INode),
    revealAllChildren: node => unfoldAllLevels(markmap, node as INode),
    getFoldRoot: () => markmap.state.data,
    applyFoldPlan: plan => applyFoldPlan(markmap, plan),
    fitContent: () => markmap.fit(),
    goToSourceLine,
    beginLiveLayout: () => {
      if (savedDuration !== null) return
      savedDuration = markmap.options.duration ?? 500
      markmap.options.duration = 0
    },
    endLiveLayout: () => {
      if (savedDuration === null) return
      markmap.options.duration = savedDuration
      savedDuration = null
    },
    relayout: () => markmap.renderData(),
  })

  recenterOnCircleClick(markmap, node => void centerSubtree(markmap, node))
  return editor
}
