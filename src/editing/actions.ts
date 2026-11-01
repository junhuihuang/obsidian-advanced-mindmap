/** Every command the editor can run from its mobile action bar. */
export type EditorCommand =
  | 'edit'
  | 'addChild'
  | 'addSibling'
  | 'remove'
  | 'focus'
  | 'fold'
  | 'unfold'
  | 'cut'
  | 'paste'
  | 'undo'
  | 'redo'

/** The editor state the action bar reflects. */
export interface ActionState {
  /** Number of selected nodes. */
  selectedCount: number
  /** Whether the primary node's children are currently hidden. */
  folded: boolean
  /** Whether focus mode is on (dim everything but the cursor and its children). */
  focused: boolean
  /** Whether nodes are marked with cut, waiting to be pasted. */
  hasClipboard: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface EditorAction {
  command: EditorCommand
  disabled: boolean
  /** Whether the command is "on" (only meaningful for cut). */
  active: boolean
}

/**
 * The ordered action-bar buttons for `state`. The fold slot yields `fold` or
 * `unfold` depending on whether the primary node is currently collapsed.
 */
export function editorActions(state: ActionState): EditorAction[] {
  const hasSelection = state.selectedCount > 0
  const entry = (command: EditorCommand, disabled: boolean, active = false): EditorAction =>
    ({ command, disabled, active })

  return [
    entry('edit', !hasSelection),
    entry('addChild', !hasSelection),
    entry('addSibling', !hasSelection),
    entry('remove', !hasSelection),
    entry('focus', !hasSelection, state.focused),
    entry(state.folded ? 'unfold' : 'fold', !hasSelection),
    entry('cut', !hasSelection, state.hasClipboard),
    entry('paste', !hasSelection || !state.hasClipboard),
    entry('undo', !state.canUndo),
    entry('redo', !state.canRedo),
  ]
}

/** Whether the action bar is worth showing at all. */
export function shouldShowActions(state: ActionState): boolean {
  return state.selectedCount > 0 || state.hasClipboard || state.canUndo || state.canRedo
}
