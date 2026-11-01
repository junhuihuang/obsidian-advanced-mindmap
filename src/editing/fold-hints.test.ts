import { describe, expect, it } from 'vitest'

import { FOLD_HINTS } from './fold-hints'
import { resolveFoldSequence, type FoldAction } from './keymap'

const ALL_ACTIONS: FoldAction[] = ['fold', 'foldLevel', 'unfold', 'unfoldAll', 'toggleAll']

describe('FOLD_HINTS', () => {
  it('advertises every fold action exactly once', () => {
    expect(FOLD_HINTS.map(hint => hint.action).sort()).toEqual([...ALL_ACTIONS].sort())
  })

  it('uses a key that resolves to the advertised action', () => {
    for (const hint of FOLD_HINTS) {
      expect(resolveFoldSequence('z', hint.key)).toEqual({ pending: null, action: hint.action })
    }
  })
})
