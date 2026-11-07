import { getApp } from 'src/core/app'
import { IMarkmapOptions } from 'markmap-view'
import { TFile, WorkspaceLeaf } from 'obsidian'

import { FileSettings, globalSettings } from 'src/settings/filesystem'
import { ScreenshotColors, takeScreenshot } from 'src/rendering/screenshot'
import { createMarkmap, getOptions, transformMarkdown, splitMarkdown } from './renderer-common'
import { createMindmapEditor } from './editor-wiring'
import MindmapView from 'src/views/view'
import { svgs } from 'src/internal-links/handle-internal-links'
import { parseSource } from 'src/editing/source-tree'
import { addTitleToRootNode, expandLevelWithTitle, titleWrapsRoot } from './root-title'
import { createTreeUpdater } from './tree-updater'
import { createMarkdownSplit } from './markdown-split'
import { removeChildlessCircles } from 'src/rendering/node-circles'
import { applyNodeWidths } from 'src/rendering/node-widths'
import { nodeWidthsFor, saveNodeWidth } from 'src/settings/filesystem'
import { latestRenderQueue } from './render-queue'


export type TabRenderer = ReturnType<typeof TabRenderer>
export function TabRenderer(containerEl: MindmapView['containerEl'], leaf: WorkspaceLeaf) {
  const contentEl = containerEl.children[1]
  const { svg, markmap } = createMarkmap({ parent: contentEl })

  const state: {
    hasRendered: boolean
    markdown: string
    screenshotColors?: ScreenshotColors
    markmapOptions?: Partial<IMarkmapOptions>
    sourceRoots?: ReturnType<typeof parseSource>
  } = {
    hasRendered: false,
    markdown: ''
  }

  let currentFile: TFile | undefined
  const renderQueue = latestRenderQueue()
  let writeQueue: Promise<void> = Promise.resolve()
  let destroyed = false
  let sourceRevision = 0
  let pendingWrites = 0
  const treeUpdater = createTreeUpdater(markmap)

  const editor = createMindmapEditor(markmap, {
    svg,
    getMarkdown: readMarkdown,
    getSourceRoots: () => state.sourceRoots ?? parseSource(state.markdown),
    setMarkdown: writeMarkdown,
    getNodeWidths: () => nodeWidthsFor(currentFile?.path ?? ''),
    setNodeWidth: (key, width) => saveNodeWidth(currentFile?.path ?? '', key, width),
    onSourceChange: treeUpdater.recordChange,
    getAnimationDuration: () => state.markmapOptions?.duration ?? 500,
    goToSourceLine: line => void markdownSplit.goToLine(line),
  })

  // The graph can only show the list/heading skeleton of a note. The button
  // next to the zoom controls opens the note itself in a native markdown split,
  // so the raw markdown is edited by Obsidian's own editor (live preview,
  // reading view, every command and shortcut) instead of a bespoke textarea.
  let markdownSourceListener: (open: boolean) => void = () => {}
  const markdownSplit = createMarkdownSplit({
    leaf,
    getFile: () => currentFile,
    onChange: open => markdownSourceListener(open),
    workspace: getApp().workspace,
  })

  return { collapseAll, firstRender, render, focus: editor.focus, destroy,

    // Zoom/fit are driven by the view's header actions (left of Obsidian's
    // "More options") instead of a floating markmap-toolbar.
    zoomIn: () => void markmap.rescale(1.25),
    zoomOut: () => void markmap.rescale(0.8),
    fit: () => void markmap.fit(),
    toggleMarkdownSource: () => void markdownSplit.toggle(),
    /**
     * Flattens every heading of this canvas to body size, and back. The class is
     * all it takes: markmap watches each label with a `ResizeObserver` and
     * re-lays out the tree when its box changes.
     */
    toggleHeadingStyles: () => {
      const on = !svg.classList.contains('advmm-heading-styles')
      svg.classList.toggle('advmm-heading-styles', on)
      return on
    },
    /** Called with `true`/`false` as the markdown split opens or closes. */
    onMarkdownSourceChange: (listener: (open: boolean) => void) => {
      markdownSourceListener = listener
    },

    takeScreenshot: () => takeScreenshot(markmap, state.screenshotColors!),
  }

  // This relies on firstRender having already happened, so state.markmapOptions is set.
  function collapseAll() {
    void markmap.setData(markmap.state.data, {
      ...state.markmapOptions,
      initialExpandLevel: 0,
    })
  }

  async function firstRender(file: TFile) {
    if (state.hasRendered) return
    state.hasRendered = true
    await render(file)
    if (destroyed) return
    void markmap.fit()
    // Focus the editor so keyboard navigation works without clicking first.
    editor.focus()
  }

  async function render(file: TFile, content?: string): Promise<void> {
    return renderQueue.schedule(() => doRender(file, content))
  }

  function destroy() {
    if (destroyed) return
    destroyed = true
    renderQueue.destroy()
    markdownSplit.destroy()
    editor.destroy()
    markmap.destroy()
    svgs.delete(svg)
  }

  async function doRender(file: TFile, content?: string) {
    if (destroyed) return
    svgs.set(svg, file)

    if (!state.hasRendered) return

    const revision = sourceRevision
    const markdown = content ?? (currentFile === file && pendingWrites > 0
      ? state.markdown : await getApp().vault.cachedRead(file))
    if (destroyed || revision !== sourceRevision) return
    currentFile = file
    state.markdown = markdown
    const { settings: fileSettings } = splitMarkdown('file', markdown)
    const settings: FileSettings = { ...globalSettings, ...fileSettings }
    const scope = `${file.path}:${file.basename}:${JSON.stringify(settings)}`
    if (treeUpdater.isCurrent(markdown, scope)) return
    state.sourceRoots = parseSource(markdown)
    let rootNode = transformMarkdown(markdown, state.sourceRoots)
    const markmapOptions = getOptions(settings)

    if (settings.titleAsRootNode) {
      const wrapped = titleWrapsRoot(rootNode)
      rootNode = addTitleToRootNode(rootNode, file.basename)
      // The title wrapper sits above the document's own root: markmap counts it
      // as the first level, so the setting is shifted to keep the document as
      // expanded as it asked to be. A title written into the root in place (or
      // not added, because the note already starts with its `H1`) adds no level.
      if (wrapped) markmapOptions.initialExpandLevel = expandLevelWithTitle(markmapOptions.initialExpandLevel)
    }

    state.markmapOptions = markmapOptions

    await treeUpdater.update(rootNode, markmapOptions, markdown, scope)
    // Per-node widths live in the plugin data, not the markdown; apply them as
    // inline label styles and re-layout before the caller fits the view.
    if (applyNodeWidths(svg, nodeWidthsFor(file.path))) await markmap.renderData()
    removeChildlessCircles(svg)
  }

  /**
   * Markdown the current render was built from. Node paths are tagged against
   * exactly this content, so edits must use it too (reading a possibly newer
   * editor value could target the wrong line).
   */
  function readMarkdown(): string {
    return state.markdown
  }

  /** Queues a disk write so a slow save can never clobber a newer one. */
  function scheduleWrite(file: TFile, markdown: string): Promise<void> {
    const next = writeQueue.then(() => getApp().vault.modify(file, markdown))
    writeQueue = next.catch(() => undefined)
    pendingWrites++
    return next.finally(() => { pendingWrites-- })
  }

  async function writeMarkdown(markdown: string) {
    const file = currentFile
    if (!file) return

    sourceRevision++
    state.markdown = markdown
    state.sourceRoots = parseSource(markdown)
    // Re-render immediately and persist in the background: the editor hangs off
    // the render, so the disk write must not delay the UI (writes stay ordered).
    const rendering = render(file, markdown)
    const writing = scheduleWrite(file, markdown)
    await rendering
    await writing
  }
}
