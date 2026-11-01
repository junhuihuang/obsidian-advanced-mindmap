import { getApp } from 'src/core/app'
import { WorkspaceLeaf } from 'obsidian'
import { MindmapSubject } from './layout-manager'
import views from './views'
import { constructView } from './view-creator'


export const leafManager = {
  close,
  reveal,
  replace,
  new(subject: MindmapSubject) {
    // Open in a new tab rather than splitting the pane.
    const leaf = getApp().workspace.getLeaf('tab')
    void constructView(leaf, subject)
  },
}

async function replace(remove: MindmapSubject | WorkspaceLeaf, add: MindmapSubject) {
  const leafToRemove = isLeaf(remove) ? remove : views.get(remove)!.leaf
  const tabGroup = leafToRemove.parent
  const index = tabGroup.children.indexOf(leafToRemove)

  const newLeaf = getApp().workspace.createLeafInParent(tabGroup, index)

  await constructView(newLeaf, add)
  leafToRemove.detach()
}

function isLeaf(msl: MindmapSubject | WorkspaceLeaf): msl is WorkspaceLeaf {
  return msl instanceof WorkspaceLeaf
}

function close(subject: MindmapSubject) {
  const view = views.get(subject)!
  view.leaf.detach()
}

function reveal(subject: MindmapSubject) {
  const view = views.get(subject)!
  getApp().workspace.setActiveLeaf(view.leaf)
}
