import { ButtonComponent, Editor, EditorPosition } from 'obsidian'
import autoBind from 'auto-bind'
import GrayMatter from 'gray-matter'

import { CodeBlockSettings, FileSettings, globalSettings, GlobalSettings } from 'src/settings/filesystem'
import { cssClasses } from 'src/constants'
import { assert, isObjectEmpty, notNullish } from 'src/utilities/utilities'
import { createMarkmap, getOptions, transformMarkdown, splitMarkdown } from 'src/rendering/renderer-common'
import { createMindmapEditor } from 'src/rendering/editor-wiring'
import { renderCodeblocks$ } from 'src/rendering/style-features'
import Callbag, { dragAndDrop, fromEvent } from 'src/utilities/callbag'
import { CodeBlockSettingsDialog } from 'src/settings/dialogs'
import { CodeBlock } from 'src/new/codeBlockHandler'
import type { NodeEditorHandle } from 'src/editing/node-editor'
import { svgs } from 'src/internal-links/handle-internal-links'
import { strings } from 'src/translation'
import { parseSource } from 'src/editing/source-tree'
import { removeChildlessCircles } from 'src/rendering/node-circles'
import { applyNodeWidths } from 'src/rendering/node-widths'
import { nodeWidthsFor, saveNodeWidth } from 'src/settings/filesystem'
import { createTreeUpdater } from './tree-updater'
import { latestRenderQueue } from './render-queue'


export type CodeBlockRenderer = ReturnType<typeof CodeBlockRenderer>
export function CodeBlockRenderer(codeBlock: CodeBlock) {
  const { component, containerEl, markdownView, editor, file } = codeBlock

  // createMarkmap should take the full markdown and render
  // transformMarkdown should be merged into this
  const { markmap, svg } = createMarkmap({ parent: containerEl })

  svgs.register(component, svg, file)

  const fileText = editor.getValue()
  const { settings: fileSettings } = splitMarkdown('file', fileText)
  const { settings: codeBlockSettings, body } = splitMarkdown('codeBlock', codeBlock.markdown)
  const settings = new SettingsManager(codeBlock, fileSettings, codeBlockSettings)

  let currentMarkdown = codeBlock.markdown
  let sourceRoots = parseSource(currentMarkdown)
  let renderQueue = latestRenderQueue()
  let destroyed = false
  const treeUpdater = createTreeUpdater(markmap)
  let editorHandle: NodeEditorHandle | undefined

  SizeManager(containerEl, svg, settings)

  if (markdownView.getMode() === 'source') {
    SettingsDialog(codeBlock, body, codeBlockSettings, fileSettings, editor)
    editorHandle = createMindmapEditor(markmap, {
      svg,
      getMarkdown: () => currentMarkdown,
      getSourceRoots: () => sourceRoots,
      setMarkdown: writeMarkdown,
      getNodeWidths: () => nodeWidthsFor(file.path),
      setNodeWidth: (key, width) => saveNodeWidth(file.path, key, width),
      onSourceChange: treeUpdater.recordChange,
      getAnimationDuration: () => settings.merged.animationDuration ?? 500,
    })
  }

  component.register(() => {
    destroyed = true
    renderQueue.destroy()
    editorHandle?.destroy()
    markmap.destroy()
  })

  render().then(() =>
    markmap.fit())

  Callbag.subscribe(renderCodeblocks$, render)

  function render(): Promise<void> {
    if (destroyed) return Promise.resolve()
    return renderQueue.schedule(() => doRender())
  }

  function doRender(): Promise<void> {
    if (destroyed) return Promise.resolve()
    const scope = JSON.stringify(settings.merged)
    if (treeUpdater.isCurrent(currentMarkdown, scope)) return Promise.resolve()
    sourceRoots = parseSource(currentMarkdown)
    const rootNode = transformMarkdown(currentMarkdown, sourceRoots)

    const markmapOptions = getOptions(settings.merged)

    const promise = treeUpdater.update(rootNode, markmapOptions, currentMarkdown, scope).then(async () => {
      if (destroyed) return
      if (applyNodeWidths(svg, nodeWidthsFor(file.path))) await markmap.renderData()
      if (!destroyed) removeChildlessCircles(svg)
    })

    const { classList } = containerEl.parentElement!
    if (settings.merged.highlight) classList.add(cssClasses.highlight)
    else classList.remove(cssClasses.highlight)

    return promise
  }

  function writeMarkdown(markdown: string) {
    currentMarkdown = markdown
    sourceRoots = parseSource(markdown)

    const sectionInfo = codeBlock.getSectionInfo()
    if (sectionInfo) {
      const text = markdown.endsWith('\n') ? markdown : `${markdown}\n`
      editor.replaceRange(
        text,
        EditorLine(sectionInfo.lineStart + 1),
        EditorLine(sectionInfo.lineEnd),
      )
    }

    // Re-render straight away; the editor no longer waits for the write, so
    // this is what makes a new node show up immediately.
    return render()
  }
}

class SettingsManager {
  private newHeight: number | undefined
  private readonly DEFAULT_HEIGHT = 150
  private settings: {
    plugin: GlobalSettings
    file: FileSettings
    codeBlock: CodeBlockSettings
  }

  constructor(
    private codeBlock: CodeBlock,
    fileSettings: FileSettings,
    codeBlockSettings: CodeBlockSettings
  ) {
    autoBind(this)
    this.settings = {
      plugin: globalSettings,
      file: fileSettings,
      codeBlock: codeBlockSettings
    }
  }

  get merged(): CodeBlockSettings {
    return { ...this.settings.plugin, ...this.settings.file, ...this.settings.codeBlock, height: this.height }
  }

  set globalSettings(s: GlobalSettings) {
    this.settings.plugin = s
  }

  set file(s: FileSettings) {
    this.settings.file = s
  }

  get height() {
    return this.newHeight ?? this.settings.codeBlock.height ?? this.DEFAULT_HEIGHT
  }
  set height(height: number) {
    if (height === this.settings.codeBlock.height)
      this.newHeight = undefined
    else
      this.newHeight = height
  }

  saveHeight() {
    if (this.newHeight === undefined) return
    this.updateFrontmatter(settings => {
      settings.height = this.height
    })
    this.newHeight = undefined
  }

  private updateFrontmatter(update: (settings: CodeBlockSettings) => void) {
    const editor = this.codeBlock.editor
    const sectionInfo = this.codeBlock.getSectionInfo()
    assert(notNullish, sectionInfo)
    const lineStart = EditorLine(sectionInfo.lineStart + 1)
    const lineEnd   = EditorLine(sectionInfo.lineEnd)

    const text = editor.getRange(lineStart, lineEnd)

    const gm = GrayMatter(text)
    gm.data.markmap ??= {}
    update(gm.data.markmap)
    if (isObjectEmpty(gm.data.markmap)) delete gm.data.markmap

    editor.replaceRange(
      GrayMatter.stringify(gm.content, gm.data),
      lineStart, lineEnd
    )
  }
}

const EditorLine = (line: number): EditorPosition => ({ line, ch: 0 })

function SizeManager(containerEl: CodeBlock['containerEl'], svg: SVGSVGElement, settings: SettingsManager) {
  svg.setCssStyles({ height: settings.height + 'px' })

  const resizeHandle = createEl('hr')
  containerEl.prepend(resizeHandle)
  resizeHandle.classList.add('workspace-leaf-resize-handle')

  const drag$ = dragAndDrop(resizeHandle)

  Callbag.subscribe(drag$, drag => {
    settings.height += drag.changeFromPrevious.y
    svg.setCssStyles({ height: settings.height + 'px' })
  })

  Callbag.subscribe(fromEvent(document, 'mouseup'), settings.saveHeight)
}

function SettingsDialog(codeBlock: CodeBlock, body: string, codeBlockSettings: CodeBlockSettings, fileSettings: FileSettings, editor: Editor) {
  const fileSettingsProxy = new Proxy({} as FileSettings, {
    get: (_, key: keyof FileSettings) => fileSettings[key],
    has: (_, key) => key in fileSettings,
    set<Key extends keyof FileSettings>(_: unknown, key: Key, value: FileSettings[Key]) {
      fileSettings[key] = value
      updateFileFrontmatter()
      return true
    },
    deleteProperty(_, key: keyof FileSettings) {
      delete fileSettings[key]
      updateFileFrontmatter()
      return true
    }
  })

  function updateFileFrontmatter() {
    const frontmatter = isObjectEmpty(fileSettings) ? {} : { markmap: fileSettings }
    editor.setValue(GrayMatter.stringify(body, frontmatter))
  }

  const codeBlockProxy = new Proxy(codeBlockSettings, {
    set<Key extends keyof CodeBlockSettings>(_: unknown, key: Key, value: CodeBlockSettings[Key]) {
      codeBlockSettings[key] = value
      updateCodeBlockFrontmatter()
      return true
    },
    deleteProperty(_, key: keyof CodeBlockSettings) {
      delete codeBlockSettings[key]
      updateCodeBlockFrontmatter()
      return true
    }
  })

  function updateCodeBlockFrontmatter() {
    const sectionInfo = codeBlock.getSectionInfo()
    assert(notNullish, sectionInfo)
    const lineStart = EditorLine(sectionInfo.lineStart + 1)
    const lineEnd   = EditorLine(sectionInfo.lineEnd)

    const text = editor.getRange(lineStart, lineEnd)

    const bodyText = GrayMatter(text).content
    const frontmatter = isObjectEmpty(codeBlockSettings) ? {} : { markmap: codeBlockSettings }

    editor.replaceRange(
      GrayMatter.stringify(bodyText, frontmatter),
      lineStart, lineEnd
    )
  }

  const button = new ButtonComponent(codeBlock.containerEl.parentElement!)
    .setClass('edit-block-button')
    .setClass('codeblock-settings-button')
    .setIcon('sliders-horizontal')
    .setTooltip(strings.blockSettingsButton)

  button.onClick(() => new CodeBlockSettingsDialog(fileSettingsProxy, codeBlockProxy).open())
}
