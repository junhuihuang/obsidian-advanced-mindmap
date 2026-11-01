import { describe, expect, it } from 'vitest'

import { editorActions, shouldShowActions, type ActionState } from './actions'


function state(overrides: Partial<ActionState> = {}): ActionState {
  return {
    selectedCount: 0,
    folded: false,
    focused: false,
    hasClipboard: false,
    canUndo: false,
    canRedo: false,
    ...overrides,
  }
}

function commands(next: ActionState): string[] {
  return editorActions(next).map(action => action.command)
}

function disabled(next: ActionState): string[] {
  return editorActions(next).filter(action => action.disabled).map(action => action.command)
}

describe('editorActions', () => {
  it('shows the node commands followed by cut/paste and history', () => {
    expect(commands(state())).toEqual([
      'edit', 'addChild', 'addSibling', 'remove', 'focus', 'fold',
      'cut', 'paste', 'undo', 'redo',
    ])
  })

  it('disables every node command when nothing is selected', () => {
    expect(disabled(state())).toEqual([
      'edit', 'addChild', 'addSibling', 'remove', 'focus', 'fold', 'cut', 'paste', 'undo', 'redo',
    ])
  })

  it('enables the node commands once a node is selected', () => {
    const actions = editorActions(state({ selectedCount: 1 }))
    const enabled = actions.filter(action => !action.disabled).map(action => action.command)
    expect(enabled).toEqual(['edit', 'addChild', 'addSibling', 'remove', 'focus', 'fold', 'cut'])
  })

  it('marks the focus button active while focus mode is on', () => {
    expect(editorActions(state({ selectedCount: 1, focused: true })).find(a => a.command === 'focus')?.active).toBe(true)
    expect(editorActions(state({ selectedCount: 1 })).find(a => a.command === 'focus')?.active).toBe(false)
  })

  it('offers "unfold" instead of "fold" when the primary node is folded', () => {
    expect(commands(state({ selectedCount: 1, folded: true }))).toContain('unfold')
    expect(commands(state({ selectedCount: 1, folded: false }))).toContain('fold')
  })

  it('only enables paste when there is a clipboard and a target', () => {
    expect(editorActions(state({ selectedCount: 1 })).find(a => a.command === 'paste')?.disabled).toBe(true)
    expect(editorActions(state({ hasClipboard: true })).find(a => a.command === 'paste')?.disabled).toBe(true)
    expect(editorActions(state({ selectedCount: 1, hasClipboard: true })).find(a => a.command === 'paste')?.disabled).toBe(false)
  })

  it('marks the cut button active while a cut is pending', () => {
    expect(editorActions(state({ selectedCount: 1, hasClipboard: true })).find(a => a.command === 'cut')?.active).toBe(true)
    expect(editorActions(state({ selectedCount: 1 })).find(a => a.command === 'cut')?.active).toBe(false)
  })

  it('tracks undo and redo availability', () => {
    expect(editorActions(state({ canUndo: true })).find(a => a.command === 'undo')?.disabled).toBe(false)
    expect(editorActions(state({ canUndo: true })).find(a => a.command === 'redo')?.disabled).toBe(true)
    expect(editorActions(state({ canRedo: true })).find(a => a.command === 'redo')?.disabled).toBe(false)
  })
})

describe('shouldShowActions', () => {
  it('hides the bar on a fresh, untouched view', () => {
    expect(shouldShowActions(state())).toBe(false)
  })

  it('shows the bar for a selection, a pending cut, or available history', () => {
    expect(shouldShowActions(state({ selectedCount: 1 }))).toBe(true)
    expect(shouldShowActions(state({ hasClipboard: true }))).toBe(true)
    expect(shouldShowActions(state({ canUndo: true }))).toBe(true)
    expect(shouldShowActions(state({ canRedo: true }))).toBe(true)
  })
})
