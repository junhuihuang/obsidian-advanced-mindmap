import type { IPureNode } from 'markmap-common'
import { describe, expect, it } from 'vitest'

import { getSourcePath, tagSourcePaths } from 'src/editing/source-paths'
import { parseSource } from 'src/editing/source-tree'
import { addTitleToRootNode, expandLevelWithTitle } from './root-title'


function node(content: string, children: IPureNode[] = []): IPureNode {
  return { content, children, payload: {} }
}

describe('addTitleToRootNode', () => {
  it('names a textless root in place, keeping it render-only', () => {
    const root = node('')
    // A flat list renders as a synthetic, textless root.
    tagSourcePaths(root, parseSource('- a\n- b\n'))
    expect(getSourcePath(root)).toEqual([])

    const titled = addTitleToRootNode(root, 'My note')

    // Still the same node, so nothing else has to move around it.
    expect(titled).toBe(root)
    expect(titled.content).toBe('My note')
    expect(getSourcePath(titled)).toEqual([])
  })

  it('wraps a root that already has text', () => {
    const root = node('My note', [node('a')])
    tagSourcePaths(root, parseSource('# My note\n- a\n'))
    expect(getSourcePath(root)).toEqual([0])

    const titled = addTitleToRootNode(root, 'My note')

    expect(titled).not.toBe(root)
    expect(titled.content).toBe('My note')
    expect(titled.children).toEqual([root])
    // The wrapper is render-only; the document's own root keeps its path.
    expect(getSourcePath(titled)).toEqual([])
    expect(getSourcePath(titled.children[0])).toEqual([0])
  })

  it('never maps the wrapper onto a node that shares its text', () => {
    const markdown = '# My note\n- a\n'
    const root = node('My note', [node('a')])
    tagSourcePaths(root, parseSource(markdown))

    const titled = addTitleToRootNode(root, 'My note')

    expect(getSourcePath(titled)).toEqual([])
    expect(getSourcePath(titled.children[0])).toEqual([0])
    expect(getSourcePath(titled.children[0].children[0])).toEqual([0, 0])
  })

  it('leaves a textless root wrapped only by the empty path', () => {
    const titled = addTitleToRootNode(node(''), 'My note')
    expect(titled.payload).toEqual({})
  })
})

describe('expandLevelWithTitle', () => {
  it('adds one level, because the wrapper counts as a level', () => {
    expect(expandLevelWithTitle(0)).toBe(1)
    expect(expandLevelWithTitle(1)).toBe(2)
    expect(expandLevelWithTitle(3)).toBe(4)
  })

  it('leaves "expand everything" and a missing value alone', () => {
    expect(expandLevelWithTitle(-1)).toBe(-1)
    expect(expandLevelWithTitle(undefined)).toBeUndefined()
  })
})
