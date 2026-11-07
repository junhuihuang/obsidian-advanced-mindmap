import type { FoldAction } from './keymap'

export interface FoldHint {
  /** Keys shown in the hint. */
  key: string
  /** A key that actually resolves to the advertised action (used by tests). */
  press: string
  action: FoldAction
}

/**
 * The commands offered after pressing `z`, shown as a hint so the two-key
 * sequences are discoverable. Order matches the display order.
 */
export const FOLD_HINTS: FoldHint[] = [
  { key: 'c', press: 'c', action: 'fold' },
  { key: 'C', press: 'C', action: 'foldLevel' },
  { key: 'o', press: 'o', action: 'unfold' },
  { key: 'O', press: 'O', action: 'unfoldAll' },
  { key: 'a', press: 'a', action: 'toggleAll' },
  { key: '0…9', press: '2', action: 'foldToLevel' },
]
