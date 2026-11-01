import { describe, expect, it, vi } from 'vitest'
import { applyEdit, removeNodes } from './source-tree'

// This file deliberately avoids the DOM harness: the batch operation is pure.
describe('batch deletion', () => {
  it('removes duplicates/nested selections once and renumbers every affected ordered list', () => {
    const markdown = '---\ntags: [keep]\n---\n# Root\n1. a\n   1. a1\n   2. a2\n   3. a3\n2. b\n3. c\n   1. c1\n   2. c2\n\nparagraph\n'
    expect(removeNodes(markdown, [[0, 0, 1], [0, 1], [0, 1], [0, 2, 0]])).toBe(
      '---\ntags: [keep]\n---\n# Root\n1. a\n   1. a1\n   2. a3\n2. c\n   1. c2\n\nparagraph\n',
    )
    expect(removeNodes('- a\n  - child\n- b\n', [[0], [0, 0], [0]])).toBe('- b\n')
  })

  it('matches sequential deletions for disjoint paths including ordered sibling groups', () => {
    for (const ordered of [false, true]) {
      const marker = (i: number) => ordered ? `${i + 1}.` : '-'
      const markdown = Array.from({ length: 30 }, (_, i) => `${marker(i)} item ${i}\n    - child ${i}`).join('\n') + '\n'
      const paths = [2, 4, 9, 15, 21, 29].map(index => [index])
      const expected = [...paths].reverse().reduce((text, path) => applyEdit(text, { type: 'remove', path }), markdown)
      expect(removeNodes(markdown, paths)).toBe(expected)
    }
  })

  it('splits the document once and joins once regardless of selection size', () => {
    const markdown = '# Root\n' + Array.from({ length: 1000 }, (_, i) => `- item ${i}`).join('\n')
    const split = vi.spyOn(String.prototype, 'split')
    const join = vi.spyOn(Array.prototype, 'join')
    try {
      removeNodes(markdown, Array.from({ length: 500 }, (_, i) => [0, i * 2]))
      expect(split.mock.calls.filter(args => (args[0] as unknown) === '\n')).toHaveLength(1)
      expect(join.mock.calls.filter(args => (args[0] as unknown) === '\n')).toHaveLength(1)
    }
    finally { vi.restoreAllMocks() }
  })
})
