// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Workspace } from 'obsidian'

import { hideStatusBarClass, syncStatusBar } from './status-bar'


function workspaceWith(viewType: string | null): Workspace {
  const activeView = viewType === null ? null : { getViewType: () => viewType }
  return {
    getActiveViewOfType: () => activeView
  } as unknown as Workspace
}

describe('status bar visibility', () => {
  beforeEach(() => { document.body.className = '' })

  it('hides the status bar while a mindmap view is active', () => {
    syncStatusBar(workspaceWith('advanced-mindmap-view'))
    expect(document.body.classList.contains(hideStatusBarClass)).toBe(true)
  })

  it('shows it again as soon as another view is active', () => {
    syncStatusBar(workspaceWith('advanced-mindmap-view'))
    syncStatusBar(workspaceWith('markdown'))
    expect(document.body.classList.contains(hideStatusBarClass)).toBe(false)
  })

  it('shows it when there is no active view', () => {
    syncStatusBar(workspaceWith('advanced-mindmap-view'))
    syncStatusBar(workspaceWith(null))
    expect(document.body.classList.contains(hideStatusBarClass)).toBe(false)
  })
})
