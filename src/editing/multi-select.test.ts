import { describe, expect, it } from 'vitest'

import { pathRange, parseSource, removeNodes } from './source-tree'


describe('removeNodes', () => {
  it('returns the markdown unchanged for an empty selection', () => {
    expect(removeNodes('- a\n- b', [])).toBe('- a\n- b')
  })

  it('removes a single node', () => {
    expect(removeNodes('- a\n- b\n- c', [[1]])).toBe('- a\n- c')
  })

  it('removes multiple sibling nodes', () => {
    expect(removeNodes('- a\n- b\n- c\n- d', [[0], [2]])).toBe('- b\n- d')
  })

  it('removes a parent and its descendant only once', () => {
    const markdown = '- a\n  - a1\n  - a2\n- b'
    expect(removeNodes(markdown, [[0], [0, 0]])).toBe('- b')
  })

  it('removes nodes across different branches', () => {
    const markdown = [
      '- a',
      '  - a1',
      '- b',
      '  - b1',
    ].join('\n')

    expect(removeNodes(markdown, [[0, 0], [1, 0]])).toBe('- a\n- b')
  })

  it('renumbers ordered lists', () => {
    expect(removeNodes('1. a\n2. b\n3. c', [[0], [1]])).toBe('1. c')
  })

  it('removes nested nodes and keeps the rest nested', () => {
    const markdown = [
      '4. parent',
      '    1. a',
      '    2. b',
      '    3. c',
    ].join('\n')

    expect(removeNodes(markdown, [[0, 0], [0, 2]])).toBe('4. parent\n    1. b')
  })
})

describe('pathRange', () => {
  const roots = parseSource('# Root\n## A\n### A1\n## B\n### B1')

  it('returns the pre-order range between two paths', () => {
    expect(pathRange(roots, [0, 0], [0, 0, 0])).toEqual([
      [0, 0],
      [0, 0, 0],
    ])
  })

  it('works when the range is reversed', () => {
    expect(pathRange(roots, [0, 0, 0], [0, 0])).toEqual([
      [0, 0],
      [0, 0, 0],
    ])
  })

  it('spans across branches', () => {
    expect(pathRange(roots, [0, 0], [0, 1])).toEqual([
      [0, 0],
      [0, 0, 0],
      [0, 1],
    ])
  })

  it('returns a single path for the same node', () => {
    expect(pathRange(roots, [0, 1], [0, 1])).toEqual([[0, 1]])
  })

  it('falls back to the target when a path is unknown', () => {
    expect(pathRange(roots, [9, 9], [0, 1])).toEqual([[0, 1]])
  })
})
