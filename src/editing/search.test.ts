import { describe, expect, it } from 'vitest'

import { collectSearchNodes, findMatches, isQueryEmpty, stepIndex } from './search'
import { parseSource } from './source-tree'


const nodes = (markdown: string) => collectSearchNodes(parseSource(markdown))

describe('isQueryEmpty', () => {
  it('treats an empty or blank query as empty', () => {
    expect(isQueryEmpty('')).toBe(true)
    expect(isQueryEmpty('   ')).toBe(true)
    expect(isQueryEmpty('a')).toBe(false)
  })
})

describe('collectSearchNodes', () => {
  it('flattens the source tree in document order', () => {
    const result = nodes('- apple\n  - banana\n- cherry\n')
    expect(result.map(node => node.path)).toEqual([[0], [0, 0], [1]])
  })

  it('walks three levels deep in pre-order', () => {
    const result = nodes('- a\n  - b\n    - c\n  - d\n- e\n')
    expect(result.map(node => node.path)).toEqual([[0], [0, 0], [0, 0, 0], [0, 1], [1]])
    expect(result.map(node => node.text)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('collects headings, nested lists and paragraphs in one pass', () => {
    const result = nodes('# Title\n\n- one\n  - two\n\n## Second\n')
    expect(result.map(node => node.path)).toEqual([[0], [0, 0], [0, 0, 0], [0, 1]])
    expect(result.map(node => node.text)).toEqual(['Title', 'one', 'two', 'Second'])
  })

  it('searches the plain text of each node (markdown stripped)', () => {
    const result = nodes('- **bold** and `code`\n- [[Page|Alias]]\n')
    expect(result.map(node => node.text)).toEqual(['bold and code', 'Alias'])
  })
})

describe('findMatches', () => {
  it('matches case-insensitively in document order', () => {
    const all = nodes('- Apple\n  - banana\n- pineapple\n')
    expect(findMatches(all, 'app')).toEqual([[0], [1]])
  })

  it('returns no matches for a blank query', () => {
    const all = nodes('- a\n- b\n')
    expect(findMatches(all, '   ')).toEqual([])
  })

  it('matches against the stripped text', () => {
    const all = nodes('- **bold**\n')
    expect(findMatches(all, 'bold')).toEqual([[0]])
  })

  it('returns no matches when nothing contains the query', () => {
    const all = nodes('- a\n- b\n')
    expect(findMatches(all, 'zzz')).toEqual([])
  })
})

describe('stepIndex', () => {
  it('wraps forward past the end', () => {
    expect(stepIndex(1, 3, 1)).toBe(2)
    expect(stepIndex(2, 3, 1)).toBe(0)
  })

  it('wraps backward past the start', () => {
    expect(stepIndex(1, 3, -1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
  })

  it('clamps to 0 when there are no matches', () => {
    expect(stepIndex(5, 0, 1)).toBe(0)
  })
})
