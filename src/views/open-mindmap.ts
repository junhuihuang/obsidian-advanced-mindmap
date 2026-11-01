import { TFile } from 'obsidian'

import { getActiveFile } from './get-active-file'
import { leafManager } from './leaf-manager'
import views from './views'


/**
 * Opens the pinned mindmap for `file`, or reveals it if it is already open.
 * Defaults to the active file (used by the command and the toolbar button).
 */
export function openPinnedMindmap(file: TFile | null = getActiveFile()): void {
  if (!file) return

  if (views.has(file))
    leafManager.reveal(file)
  else
    leafManager.new(file)
}

/** Opens the unpinned mindmap, or reveals it if it is already open. */
export function openUnpinnedMindmap(): void {
  if (getActiveFile() === null) return

  if (views.has('unpinned'))
    leafManager.reveal('unpinned')
  else
    leafManager.new('unpinned')
}
