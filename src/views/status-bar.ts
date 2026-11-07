import { ItemView } from 'obsidian'
import type { Workspace } from 'obsidian'

import { MM_VIEW_TYPE } from 'src/constants'


/**
 * Body class that hides Obsidian's status bar. The status bar describes the
 * markdown file (backlinks, properties, word count…) of the active leaf, which
 * has nothing to do with the map on screen, so it is hidden while a mindmap is
 * the active view.
 */
export const hideStatusBarClass = 'advmm-hide-status-bar'

/**
 * Shows or hides the status bar for the workspace's current active leaf.
 * Idempotent, so it can be called on every `active-leaf-change` /
 * `layout-change` without tracking the previous state.
 *
 * `getActiveViewOfType(ItemView)` — not the deprecated `activeLeaf` — so both
 * the finished mindmap view and its transient `LoadingView` count.
 */
export function syncStatusBar(workspace: Workspace): void {
  const hide = workspace.getActiveViewOfType(ItemView)?.getViewType() === MM_VIEW_TYPE
  document.body.classList.toggle(hideStatusBarClass, hide)
}
