import type { IPureNode } from 'markmap-common'
import { describe, expect, it } from 'vitest'

import { focusPaths, siblingPaths } from './focus'
import { parseSource } from './source-tree'
import { SOURCE_PATH_KEY } from './source-paths'

function node(path: number[] | undefined, children: IPureNode[] = []): IPureNode {
  return {
    content: 'x',
    children,
    payload: path ? { [SOURCE_PATH_KEY]: path } : {},
  } as IPureNode
}

describe('focusPaths', () => {
  it('keeps the cursor node and its direct children', () => {
    const tree = node([0], [node([0, 0]), node([0, 1])])
    expect(focusPaths([0], tree)).toEqual([[0], [0, 0], [0, 1]])
  })

  it('skips children without a source path', () => {
    const tree = node([0], [node(undefined), node([0, 1])])
    expect(focusPaths([0], tree)).toEqual([[0], [0, 1]])
  })

  it('does not descend past the direct children', () => {
    const tree = node([0], [node([0, 0], [node([0, 0, 0])])])
    expect(focusPaths([0], tree)).toEqual([[0], [0, 0]])
  })

  it('returns only the cursor when it has no children', () => {
    expect(focusPaths([0], node([0]))).toEqual([[0]])
  })

  it('keeps all siblings at the cursor level', () => {
    const roots = parseSource('- a\n- b\n- c\n')
    expect(siblingPaths([1], roots)).toEqual([[0], [1], [2]])
  })

  it('keeps nested siblings without their parent or children', () => {
    const roots = parseSource('- a\n  - a1\n  - a2\n- b\n')
    expect(siblingPaths([0, 1], roots)).toEqual([[0, 0], [0, 1]])
  })

  it('keeps only the synthetic root when it has no siblings', () => {
    expect(siblingPaths([], parseSource('- a'))).toEqual([[]])
  })

})
