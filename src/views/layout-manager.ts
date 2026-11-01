import type { WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf, TFile } from 'obsidian'
import { MM_VIEW_TYPE } from 'src/constants'
import { leafManager } from './leaf-manager'
import { LoadingView } from './loading-view'
import MindmapView from './view'
import { getActiveFile } from './get-active-file'
import views from './views'
import { layout } from 'src/settings/filesystem'

export type MindmapSubject = TFile | 'unpinned'

type Tree = Tabs | Split
type Split = Tree[]
type Tabs = (FlatSubject | null)[]
// Legacy arrays were relative to rootSplit.children[0]. Version the new
// format so that those arrays are never mistaken for a whole-root layout.
export type Layout = Tree | { version: 1, root: Tree }
type Branch = WorkspaceSplit | WorkspaceTabs
type Node = Branch | WorkspaceLeaf

type FlatSubject =
| { type: 'unpinned' }
| { type: 'pinned', path: TFile['path'] }

export const layoutManager = {
  serialise: () => layout.save({ version: 1, root: serialise(app.workspace.rootSplit) }),
  deserialise,
  renderVisible: () => renderVisible(app.workspace.rootSplit),
}

function serialise(node: Node): any {
  if ('children' in node) return node.children.map(child => serialise(child as Node))
  if (node.view.getViewType() !== MM_VIEW_TYPE) return null
  const subject = views.get(node.view as MindmapView)
  if (!subject) return null
  return subject === 'unpinned'
    ? { type: 'unpinned' }
    : { type: 'pinned', path: subject.path }
}

function renderLeaf(leaf: WorkspaceLeaf | undefined) {
  if (!(leaf?.view instanceof MindmapView)) return
  const subject = views.get(leaf.view)
  const file = subject === 'unpinned' ? getActiveFile() : subject
  if (file) leaf.view.firstRender(file)
}

function renderVisible(node: Branch) {
  if (node.type === 'tabs') {
    const tabs = node as WorkspaceTabs
    renderLeaf(tabs.children[tabs.currentTab])
  }
  else {
    for (const child of node.children) renderVisible(child as Branch)
  }
}

async function deserialise() {
  const saved = layout.load()
  const root = app.workspace.rootSplit
  const activeTabs = app.workspace.activeTabGroup

  async function restore(tree: Tree, node: Branch | undefined): Promise<void> {
    if (!node) return
    if (node.type === 'split') {
      if (!Array.isArray(tree[0])) return
      // Replacing leaves mutates workspace arrays; always pair against a
      // snapshot, not an array being modified by the restoration itself.
      const children = [...node.children]
      for (const [index, child] of (tree as Split).entries()) {
        await restore(child, children[index] as Branch | undefined)
      }
      return
    }
    if (Array.isArray(tree[0])) return
    const tabs = node as WorkspaceTabs
    const currentIndex = tabs.currentTab
    const leaves = [...tabs.children]
    for (const [index, subject] of (tree as Tabs).entries()) {
      if (!subject || !leaves[index]) continue
      const file = subject.type === 'unpinned'
        ? 'unpinned'
        : app.vault.getMarkdownFiles().find(file => file.path === subject.path)
      if (file) await leafManager.replace(leaves[index], file)
    }
    const current = tabs.children[currentIndex]
    if (current) {
      app.workspace.setActiveLeaf(current)
      renderLeaf(current)
    }
  }

  if (Array.isArray(saved)) {
    // Old data only described the first root child. Its missing right-hand
    // entries cannot be reconstructed, but the saved left-hand tabs can.
    await restore(saved, root.children[0] as Branch | undefined)
  }
  else {
    await restore(saved.root, root)
  }

  const activeLeaf = activeTabs?.children[activeTabs.currentTab]
  if (activeLeaf) app.workspace.setActiveLeaf(activeLeaf)
  LoadingView.closeAll()
}
