import type { FoldAction } from './keymap'

export interface FoldHint {
  /** Second key of the `z`-prefixed command. */
  key: string
  action: FoldAction
}

/**
 * The commands offered after pressing `z`, shown as a hint so the two-key
 * sequences are discoverable. Order matches the display order.
 */
export const FOLD_HINTS: FoldHint[] = [
  { key: 'c', action: 'fold' },
  { key: 'C', action: 'foldLevel' },
  { key: 'o', action: 'unfold' },
  { key: 'O', action: 'unfoldAll' },
  { key: 'a', action: 'toggleAll' },
]
