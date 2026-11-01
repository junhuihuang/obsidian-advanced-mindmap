import { TFile, WorkspaceLeaf } from 'obsidian'
import { layoutManager } from './layout-manager'
import { LoadingView } from './loading-view'
import { getActiveFile } from './get-active-file'
import views from './views'
import { globalSettings } from 'src/settings/filesystem'
import { setViewCreator } from './view-creator'
import { leafManager } from './leaf-manager'
import { commandOpenPinned, commandOpenUnpinned, fileChanged, fileOpen, fileRenamed, layoutChange, pin, start, unpin } from 'src/core/events'
import { openPinnedMindmap, openUnpinnedMindmap } from './open-mindmap'
import Callbag from 'src/utilities/callbag'


Callbag.subscribe(start, () =>
  setViewCreator((leaf: WorkspaceLeaf) => new LoadingView(leaf)))

Callbag.subscribe(layoutChange, () => {
  layoutManager.serialise()

  layoutManager.renderVisible()
})

Callbag.subscribe(pin, () => {
  const activeFile = getActiveFile()!
  if (views.has(activeFile)) {
    leafManager.close(activeFile)
    leafManager.replace('unpinned', activeFile)
  }
  else
    leafManager.replace('unpinned', activeFile)
})
Callbag.subscribe(unpin, (file: TFile) => {
  if (views.has('unpinned')) {
    leafManager.close('unpinned')
    leafManager.replace(file, 'unpinned')
  }
  else
    leafManager.replace(file, 'unpinned')
})

Callbag.subscribe(fileOpen, file => {
  if (file?.extension !== 'md') return

  if (views.has(file)) {
    const view = views.get(file)!
    view.render(file)
  }

  if (views.has('unpinned')) {
    const view = views.get('unpinned')!
    view.render(file)
  }
})

Callbag.subscribe(fileRenamed, ({ path }) => {
  const activeFile = getActiveFile()
  const unpinned = views.get('unpinned')
  if (unpinned && activeFile && activeFile.path === path && globalSettings.titleAsRootNode)
    unpinned.render(activeFile)

  const result = views.getByPath(path)
  if (result) {
    const { view, file } = result
    view.setDisplayText(file.basename)
    view.render(file)
  }
})

Callbag.subscribe(commandOpenUnpinned, openUnpinnedMindmap)

Callbag.subscribe(commandOpenPinned, () => openPinnedMindmap())

Callbag.subscribe(fileChanged, ({ editor, info: { file } }) => {
  file = file!

  if (file.extension !== 'md') return

  const content = editor.getValue()

  if (views.has(file)) {
    const view = views.get(file)!
    view.render(file, content)
  }

  if (views.has('unpinned')) {
    const view = views.get('unpinned')!
    view.render(file, content)
  }
})

