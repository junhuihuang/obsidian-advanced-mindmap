/** Identifiers for the labels shown next to each shortcut. */
export type HelpLabel =
  | 'move'
  | 'extend'
  | 'home'
  | 'edit'
  | 'child'
  | 'sibling'
  | 'remove'
  | 'cut'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'rename'
  | 'reorder'
  | 'escape'
  | 'focus'
  | 'focusSiblings'
  | 'center'
  | 'fold'
  | 'foldLevel'
  | 'unfold'
  | 'unfoldAll'
  | 'toggleAll'
  | 'zoom'
  | 'search'
  | 'searchNext'
  | 'goToDefinition'
  | 'help'
  | 'drag'
  | 'pan'
  | 'marquee'
  | 'resize'
  | 'resizeWidth'

/** Identifiers for the translation keys of the section headings. */
export type HelpSectionId = 'navigation' | 'editing' | 'view' | 'mouse'

export interface HelpEntry {
  /** The keys to press, shown verbatim in a `<kbd>`. */
  keys: string
  /** Which translated description to show next to the keys. */
  label: HelpLabel
}

export interface HelpSection {
  id: HelpSectionId
  entries: HelpEntry[]
}

/**
 * The full keyboard/mouse reference shown by `?`. Kept free of DOM and
 * translation code so it can be tested directly.
 */
export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'navigation',
    entries: [
      { keys: '↑ ↓ ← →', label: 'move' },
      { keys: 'k j h l', label: 'move' },
      { keys: 'Shift + move', label: 'extend' },
      { keys: 'any arrow', label: 'home' },
    ],
  },
  {
    id: 'editing',
    entries: [
      { keys: 'i', label: 'edit' },
      { keys: 'Tab', label: 'child' },
      { keys: 'Enter', label: 'sibling' },
      { keys: 'Backspace', label: 'remove' },
      { keys: 'Ctrl+X', label: 'cut' },
      { keys: 'Ctrl+V', label: 'paste' },
      { keys: 'Ctrl+Z', label: 'undo' },
      { keys: 'Ctrl+U', label: 'redo' },
      { keys: 'J / K', label: 'reorder' },
      { keys: 'Double-click', label: 'rename' },
      { keys: 'Esc', label: 'escape' },
    ],
  },
  {
    id: 'view',
    entries: [
      { keys: 'f', label: 'focus' },
      { keys: 'F', label: 'focusSiblings' },
      { keys: 'Shift+M', label: 'center' },
      { keys: 'Shift + + / -', label: 'zoom' },
      { keys: 'Ctrl + Shift + + / -', label: 'resizeWidth' },
      { keys: 'z c', label: 'fold' },
      { keys: 'z C', label: 'foldLevel' },
      { keys: 'z o', label: 'unfold' },
      { keys: 'z O', label: 'unfoldAll' },
      { keys: 'z a', label: 'toggleAll' },
      { keys: '/', label: 'search' },
      { keys: 'n / p', label: 'searchNext' },
      { keys: '?', label: 'help' },
      { keys: 'g d', label: 'goToDefinition' },
    ],
  },
  {
    id: 'mouse',
    entries: [
      { keys: 'Drag node', label: 'drag' },
      { keys: 'Drag empty', label: 'marquee' },
      { keys: 'Right-drag', label: 'pan' },
      { keys: 'Drag right edge', label: 'resize' },
    ],
  },
]
