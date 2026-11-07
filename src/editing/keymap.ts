export type NodeAction = 'addChild' | 'addSibling' | 'remove' | 'edit' | 'center' | 'focus' | 'focusSiblings' | 'moveDown' | 'moveUp'
export type EditingAction = 'addChild' | 'commit' | 'cancel'
export type Direction = 'up' | 'down' | 'left' | 'right'
export type FoldAction = 'fold' | 'foldLevel' | 'foldToLevel' | 'unfold' | 'unfoldAll' | 'toggleAll'
export type ZoomAction = 'in' | 'out'
export type ResizeAction = 'wider' | 'narrower'

/** First key of the vim-style two-key fold commands (`zc` / `zC` / ...). */
export const FOLD_PREFIX = 'z'

/** First key of the `gd` (go-to-definition) command. */
export const GOTO_PREFIX = 'g'

/** Key values that only change modifiers and should never end a sequence. */
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'AltGraph',
  'OS',
  'Fn',
  'FnLock',
])

/**
 * Whether a `KeyboardEvent.key` is a lone modifier. These arrive as their own
 * keydown before the modified key, so the `z` sequence has to ignore them.
 */
export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

export interface FoldSequenceResult {
  /** The pending prefix after this key, or null when no sequence is in progress. */
  pending: string | null
  /** The fold command resolved by this key, if any. */
  action?: FoldAction
  /** Target level of a `foldToLevel` action (`0` shows only the root). */
  level?: number
}

/**
 * Vim-style two-key fold commands, all after `z`:
 *
 *  - `zc` folds the selected node (or the whole tree one level when nothing is selected)
 *  - `zC` folds one level of the selected node's subtree (or of the whole tree when
 *    nothing is selected), so pressing it repeatedly walks the levels down
 *  - `zo` unfolds one level of the selected node (or of the whole tree)
 *  - `zO` unfolds every descendant of the selected node (or the whole tree)
 *  - `za` / `zA` toggle between fully collapsed and fully expanded
 *  - `z0`…`z9` fold the whole tree to exactly that many levels, which is much
 *    faster than walking down level by level on a large document
 *
 * `a` is case-insensitive (`zA` is an alias), but `c`/`C` and `o`/`O` differ:
 * the uppercase key acts on the *subtree* (fold) or on the whole tree (unfold).
 * `pending` is the first key of an unfinished sequence from the previous keydown
 * (or null).
 */
export function resolveFoldSequence(pending: string | null, key: string): FoldSequenceResult {
  if (pending === FOLD_PREFIX) {
    // `z` + digit: jump straight to a visible depth. Only a single digit, so
    // `z1` acts immediately instead of waiting to see whether `z12` follows.
    if (key.length === 1 && key >= '0' && key <= '9') {
      return { pending: null, action: 'foldToLevel', level: Number(key) }
    }

    const lower = key.length === 1 ? key.toLowerCase() : key
    switch (lower) {
      case 'c': return { pending: null, action: key === 'C' ? 'foldLevel' : 'fold' }
      case 'o': return { pending: null, action: key === 'O' ? 'unfoldAll' : 'unfold' }
      case 'a': return { pending: null, action: 'toggleAll' }
      default: return { pending: null }
    }
  }

  if (key === FOLD_PREFIX || key === FOLD_PREFIX.toUpperCase()) return { pending: FOLD_PREFIX }
  return { pending: null }
}

/**
 * Maps arrows and vim `hjkl` to a direction. `h`/`l` move to the parent/child
 * and `j`/`k` to the next/previous sibling, matching the mindmap layout. Only
 * the *lowercase* vim keys navigate: `J`/`K` move the selected node instead
 * (see `nodeActionForKey`), and the other capitals are left free, as in vim.
 */
export function directionForKey(key: string): Direction | undefined {
  switch (key) {
    case 'ArrowUp': return 'up'
    case 'ArrowDown': return 'down'
    case 'ArrowLeft': return 'left'
    case 'ArrowRight': return 'right'
    case 'k': return 'up'
    case 'j': return 'down'
    case 'h': return 'left'
    case 'l': return 'right'
    default: return undefined
  }
}

/** Action for a key pressed while a node is selected (but not being edited). */
export function nodeActionForKey(key: string): NodeAction | undefined {
  switch (key) {
    case 'Tab': return 'addChild'
    case 'Enter': return 'addSibling'
    case 'Backspace':
    case 'Delete': return 'remove'
    case 'i': return 'edit'
    // `f` toggles focus mode: the cursor node and its direct children stay
    // prominent while the rest of the tree is dimmed.
    case 'f': return 'focus'
    // `F` focuses the cursor's sibling group instead.
    case 'F': return 'focusSiblings'
    // `Shift+M` (uppercase `M`) centers the selected node in the viewport.
    case 'M': return 'center'
    // `J`/`K` move the selected node one step down/up among its siblings,
    // matching vim's `j`/`k` navigation: lowercase moves the cursor, uppercase
    // moves the node.
    case 'J': return 'moveDown'
    case 'K': return 'moveUp'
    default: return undefined
  }
}

/**
 * `Shift` + `+` zooms in and `Shift` + `-` zooms out. On a US layout those
 * arrive as `+` and `_`; the numpad `+`/`-` report `+` and `-` directly.
 * `Ctrl`/`Cmd` is explicitly excluded: that combination resizes the selected
 * node instead (see `resizeCommandForEvent`). Unlike the node actions, zooming
 * also works with nothing selected (it then uses the center of the viewport).
 */
export function zoomCommandForEvent(event: KeyCombo): ZoomAction | undefined {
  if (event.ctrlKey || event.metaKey || !event.shiftKey) return undefined

  switch (event.key) {
    case '+': return 'in'
    case '_':
    case '-': return 'out'
    default: return undefined
  }
}

/**
 * `Ctrl` + `Shift` + `+` widens the selected node and `Ctrl` + `Shift` + `-`
 * narrows it: the keyboard equivalent of dragging the node's right edge. The
 * node has to be selected (the synthetic root and opaque code/table blocks have
 * no width of their own).
 */
export function resizeCommandForEvent(event: KeyCombo): ResizeAction | undefined {
  if ((!event.ctrlKey && !event.metaKey) || !event.shiftKey) return undefined

  switch (event.key) {
    case '+': return 'wider'
    case '_':
    case '-': return 'narrower'
    default: return undefined
  }
}

export type ClipboardCommand = 'cut' | 'paste' | 'undo' | 'redo'

/** The subset of a `KeyboardEvent` needed to recognise shortcuts. */
export interface KeyCombo {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/**
 * Maps Ctrl/Cmd shortcuts to their command: `Ctrl+Z` undoes, `Ctrl+U` redoes.
 * Returns `undefined` for anything else.
 */
export function clipboardCommandForEvent(event: KeyCombo): ClipboardCommand | undefined {
  if (!event.ctrlKey && !event.metaKey) return undefined

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  switch (key) {
    case 'x': return event.shiftKey ? undefined : 'cut'
    case 'v': return event.shiftKey ? undefined : 'paste'
    case 'z': return event.shiftKey ? undefined : 'undo'
    case 'u': return event.shiftKey ? undefined : 'redo'
    default: return undefined
  }
}

/** Action for a key pressed while editing a node's text. */
export function editingActionForKey(key: string): EditingAction | undefined {
  switch (key) {
    case 'Tab': return 'addChild'
    // The first Enter just saves the text and selects the node. A second Enter
    // (now in the selected state) adds a sibling.
    case 'Enter': return 'commit'
    case 'Escape': return 'cancel'
    default: return undefined
  }
}
