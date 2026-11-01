import { describe, expect, it } from 'vitest'

import { clipboardCommandForEvent, editingActionForKey, GOTO_PREFIX, isModifierKey, nodeActionForKey, resizeCommandForEvent, resolveFoldSequence, zoomCommandForEvent, type KeyCombo } from './keymap'


describe('nodeActionForKey', () => {
  it('maps Tab to addChild', () => {
    expect(nodeActionForKey('Tab')).toBe('addChild')
  })

  it('maps Enter to addSibling', () => {
    expect(nodeActionForKey('Enter')).toBe('addSibling')
  })

  it('maps Backspace to remove', () => {
    expect(nodeActionForKey('Backspace')).toBe('remove')
  })

  it('maps Delete to remove', () => {
    expect(nodeActionForKey('Delete')).toBe('remove')
  })

  it('maps i to edit', () => {
    expect(nodeActionForKey('i')).toBe('edit')
  })

  it('maps Shift+M to center', () => {
    expect(nodeActionForKey('M')).toBe('center')
  })

  it('does not center on a plain m', () => {
    expect(nodeActionForKey('m')).toBeUndefined()
  })

  it('maps f to focus', () => {
    expect(nodeActionForKey('f')).toBe('focus')
  })

  it('maps F to sibling focus', () => {
    expect(nodeActionForKey('F')).toBe('focusSiblings')
  })
  it('maps J to moveDown and K to moveUp', () => {
    expect(nodeActionForKey('J')).toBe('moveDown')
    expect(nodeActionForKey('K')).toBe('moveUp')
  })

  it('does not move on the lowercase navigation keys', () => {
    expect(nodeActionForKey('j')).toBeUndefined()
    expect(nodeActionForKey('k')).toBeUndefined()
  })

  it('ignores other keys', () => {
    expect(nodeActionForKey('a')).toBeUndefined()
    expect(nodeActionForKey('Escape')).toBeUndefined()
    expect(nodeActionForKey('ArrowDown')).toBeUndefined()
  })
})

describe('resolveFoldSequence', () => {
  it('starts a sequence on z', () => {
    expect(resolveFoldSequence(null, 'z')).toEqual({ pending: 'z' })
  })

  it('folds on zc', () => {
    expect(resolveFoldSequence('z', 'c')).toEqual({ pending: null, action: 'fold' })
  })

  it('unfolds one level on zo', () => {
    expect(resolveFoldSequence('z', 'o')).toEqual({ pending: null, action: 'unfold' })
  })

  it('unfolds the whole subtree on zO', () => {
    expect(resolveFoldSequence('z', 'O')).toEqual({ pending: null, action: 'unfoldAll' })
  })

  it('folds the whole tree one level on zC', () => {
    expect(resolveFoldSequence('z', 'C')).toEqual({ pending: null, action: 'foldLevel' })
  })

  it('toggles every fold on za and zA', () => {
    expect(resolveFoldSequence('z', 'a')).toEqual({ pending: null, action: 'toggleAll' })
    expect(resolveFoldSequence('z', 'A')).toEqual({ pending: null, action: 'toggleAll' })
  })

  it('cancels an unknown sequence without resolving an action', () => {
    expect(resolveFoldSequence('z', 'x')).toEqual({ pending: null })
  })

  it('does not consume unrelated keys', () => {
    expect(resolveFoldSequence(null, 'j')).toEqual({ pending: null })
    expect(resolveFoldSequence(null, 'Enter')).toEqual({ pending: null })
  })

  it('restarts the sequence when z is pressed twice', () => {
    expect(resolveFoldSequence('z', 'z')).toEqual({ pending: null })
  })
})

describe('editingActionForKey', () => {
  it('maps Tab to addChild', () => {
    expect(editingActionForKey('Tab')).toBe('addChild')
  })

  it('maps Enter to commit (save and select)', () => {
    expect(editingActionForKey('Enter')).toBe('commit')
  })

  it('does not add a sibling while editing', () => {
    expect(editingActionForKey('Enter')).not.toBe('addSibling')
  })

  it('maps Escape to cancel', () => {
    expect(editingActionForKey('Escape')).toBe('cancel')
  })

  it('does not delete the node while editing text', () => {
    expect(editingActionForKey('Backspace')).toBeUndefined()
    expect(editingActionForKey('Delete')).toBeUndefined()
  })

  it('ignores other keys', () => {
    expect(editingActionForKey('a')).toBeUndefined()
  })
})

describe('clipboardCommandForEvent', () => {
  it('maps ctrl+x to cut and ctrl+v to paste', () => {
    expect(clipboardCommandForEvent({ key: 'x', ctrlKey: true })).toBe('cut')
    expect(clipboardCommandForEvent({ key: 'v', ctrlKey: true })).toBe('paste')
  })

  it('maps cmd+x / cmd+v too', () => {
    expect(clipboardCommandForEvent({ key: 'x', metaKey: true })).toBe('cut')
    expect(clipboardCommandForEvent({ key: 'v', metaKey: true })).toBe('paste')
  })

  it('maps ctrl+z to undo', () => {
    expect(clipboardCommandForEvent({ key: 'z', ctrlKey: true })).toBe('undo')
  })

  it('maps ctrl+u to redo', () => {
    expect(clipboardCommandForEvent({ key: 'u', ctrlKey: true })).toBe('redo')
  })

  it('ignores ctrl+shift+z and ctrl+y', () => {
    expect(clipboardCommandForEvent({ key: 'z', ctrlKey: true, shiftKey: true })).toBeUndefined()
    expect(clipboardCommandForEvent({ key: 'y', ctrlKey: true })).toBeUndefined()
  })

  it('accepts uppercase letters', () => {
    expect(clipboardCommandForEvent({ key: 'X', ctrlKey: true })).toBe('cut')
    expect(clipboardCommandForEvent({ key: 'Z', ctrlKey: true })).toBe('undo')
  })

  it('requires ctrl or cmd', () => {
    expect(clipboardCommandForEvent({ key: 'x' })).toBeUndefined()
    expect(clipboardCommandForEvent({ key: 'z', shiftKey: true })).toBeUndefined()
  })

  it('ignores unrelated shortcuts', () => {
    expect(clipboardCommandForEvent({ key: 'a', ctrlKey: true })).toBeUndefined()
    expect(clipboardCommandForEvent({ key: 'ArrowUp', ctrlKey: true })).toBeUndefined()
  })
})

describe('zoomCommandForEvent', () => {
  const zoom = (key: string, init: Partial<KeyCombo> = {}) =>
    zoomCommandForEvent({ key, shiftKey: true, ...init })

  it('maps Shift++ to zoom in', () => {
    expect(zoom('+')).toBe('in')
  })

  it('maps Shift+- (underscore) to zoom out', () => {
    expect(zoom('_')).toBe('out')
  })

  it('maps the numpad Shift+minus to zoom out', () => {
    expect(zoom('-')).toBe('out')
  })

  it('requires Shift', () => {
    expect(zoomCommandForEvent({ key: '+' })).toBeUndefined()
    expect(zoomCommandForEvent({ key: '-' })).toBeUndefined()
  })

  it('leaves Ctrl/Cmd+Shift+plus/minus to the node resize shortcut', () => {
    expect(zoomCommandForEvent({ key: '+', ctrlKey: true, shiftKey: true })).toBeUndefined()
    expect(zoomCommandForEvent({ key: '_', ctrlKey: true, shiftKey: true })).toBeUndefined()
    expect(zoomCommandForEvent({ key: '-', metaKey: true, shiftKey: true })).toBeUndefined()
  })

  it('ignores unrelated keys', () => {
    for (const key of ['=', '0', 'x', 'Enter', 'ArrowUp'])
      expect(zoom(key)).toBeUndefined()
  })
})

describe('resizeCommandForEvent', () => {
  const resize = (key: string, init: Partial<KeyCombo> = {}) =>
    resizeCommandForEvent({ key, ctrlKey: true, shiftKey: true, ...init })

  it('maps Ctrl+Shift++ to a wider node', () => {
    expect(resize('+')).toBe('wider')
  })

  it('maps Ctrl+Shift+- (underscore) to a narrower node', () => {
    expect(resize('_')).toBe('narrower')
  })

  it('maps the numpad Ctrl+Shift+minus to a narrower node', () => {
    expect(resize('-')).toBe('narrower')
  })

  it('accepts Cmd on macOS', () => {
    expect(resizeCommandForEvent({ key: '+', metaKey: true, shiftKey: true })).toBe('wider')
  })

  it('requires Ctrl/Cmd and Shift', () => {
    expect(resizeCommandForEvent({ key: '+', shiftKey: true })).toBeUndefined()
    expect(resizeCommandForEvent({ key: '+', ctrlKey: true })).toBeUndefined()
  })

  it('ignores unrelated keys', () => {
    for (const key of ['=', '0', 'x', 'Enter', 'ArrowUp'])
      expect(resize(key)).toBeUndefined()
  })
})

describe('isModifierKey', () => {
  it('recognises the modifier keys', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph'])
      expect(isModifierKey(key)).toBe(true)
  })

  it('does not treat regular keys as modifiers', () => {
    for (const key of ['c', 'C', 'z', 'a', 'Enter', 'Escape', 'ArrowUp'])
      expect(isModifierKey(key)).toBe(false)
  })
})


describe('go-to-definition prefix', () => {
  it('GOTO_PREFIX is g', () => {
    expect(GOTO_PREFIX).toBe('g')
  })
})

