import type { IPureNode } from 'markmap-common'
import { describe, expect, it } from 'vitest'

import { parseSource } from './source-tree'
import { getSourcePath, normalizeContent, normalizeText, tagSourcePaths } from './source-paths'


function mm(content: string, children: IPureNode[] = []): IPureNode {
  return { content, children }
}

function withLines(node: IPureNode, lines: string): IPureNode {
  node.payload = { ...node.payload, lines }
  return node
}

describe('tagSourcePaths', () => {
  it('tags the synthetic root of an empty document with the empty path', () => {
    const root = mm('', [mm('A')])
    tagSourcePaths(root, [])
    // The rendered root still needs a path so `h` can walk up to it.
    expect(getSourcePath(root)).toEqual([])
    expect(getSourcePath(root.children[0])).toBeUndefined()
  })

  it('tags a single root node', () => {
    const root = mm('Root', [mm('A')])
    tagSourcePaths(root, parseSource('# Root\n## A'))

    expect(getSourcePath(root)).toEqual([0])
    expect(getSourcePath(root.children[0])).toEqual([0, 0])
  })

  it('tags an empty synthetic root with the empty path', () => {
    const root = mm('', [mm('A'), mm('B', [mm('B1')])])
    tagSourcePaths(root, parseSource('# A\n# B\n## B1'))

    // `[]` is the render-only root; `h` steps up to it from any top-level node.
    expect(getSourcePath(root)).toEqual([])
    expect(getSourcePath(root.children[0])).toEqual([0])
    expect(getSourcePath(root.children[1])).toEqual([1])
    expect(getSourcePath(root.children[1].children[0])).toEqual([1, 0])
  })

  it('tags nested list nodes', () => {
    const root = mm('a', [mm('a1', [mm('a1x')]), mm('a2')])
    tagSourcePaths(root, parseSource('- a\n  - a1\n    - a1x\n  - a2'))

    expect(getSourcePath(root)).toEqual([0])
    expect(getSourcePath(root.children[0])).toEqual([0, 0])
    expect(getSourcePath(root.children[0].children[0])).toEqual([0, 0, 0])
    expect(getSourcePath(root.children[1])).toEqual([0, 1])
  })

  it('tags an empty list item by its source line', () => {
    const source = parseSource('- a\n  - b\n  - \n- c')
    const root = withLines(mm('', [
      withLines(mm('a', [withLines(mm('b'), '1,2'), withLines(mm(''), '2,3')]), '0,3'),
      withLines(mm('c'), '3,4'),
    ]), '0,4')
    tagSourcePaths(root, source)

    // The synthetic root keeps the empty path; the empty item is matched purely
    // by its source line so it can still be selected and deleted.
    expect(getSourcePath(root)).toEqual([])
    expect(getSourcePath(root.children[0])).toEqual([0])
    expect(getSourcePath(root.children[0].children[1])).toEqual([0, 1])
    expect(getSourcePath(root.children[1])).toEqual([1])
  })

  it('tags an empty list item whose content is just the ordered marker', () => {
    // markmap-lib renders an empty ordered item as `"3. "`, which normalizes
    // to an empty string but is not the synthetic root.
    const source = parseSource('1. parent\n    1. a\n    2. b\n    3. \n2. after')
    const root = withLines(mm('', [
      withLines(mm('parent', [
        withLines(mm('a'), '1,2'),
        withLines(mm('b'), '2,3'),
        withLines(mm('3. '), '3,4'),
      ]), '0,4'),
      withLines(mm('after'), '4,5'),
    ]), '0,5')
    tagSourcePaths(root, source)

    expect(getSourcePath(root.children[0].children[2])).toEqual([0, 2])
  })

  it('only tags the nodes that exist on both sides', () => {
    const root = mm('Root', [mm('A'), mm('B')])
    // Source only has one child under Root.
    tagSourcePaths(root, parseSource('# Root\n## A'))

    expect(getSourcePath(root)).toEqual([0])
    expect(getSourcePath(root.children[0])).toEqual([0, 0])
    expect(getSourcePath(root.children[1])).toBeUndefined()
  })

  it('preserves existing payload keys', () => {
    const root = mm('Root')
    root.payload = { fold: 1 }
    tagSourcePaths(root, parseSource('# Root'))

    expect(root.payload.fold).toBe(1)
    expect(getSourcePath(root)).toEqual([0])
  })

  it('survives the shallow copies markmap makes when initializing data', () => {
    const root = mm('Root', [mm('A')])
    tagSourcePaths(root, parseSource('# Root\n## A'))

    // markmap-view replaces each child with `{ ...child }` while initializing.
    const copy: IPureNode = { ...root.children[0] }

    expect(getSourcePath(copy)).toEqual([0, 0])
  })

  it('keeps the tag when the root is wrapped for the title-as-root setting', () => {
    const root = mm('Root', [mm('A')])
    tagSourcePaths(root, parseSource('# Root\n## A'))

    // addTitleToRootNode wraps the root in a new node.
    const wrapped: IPureNode = { content: 'file', children: [root] }

    expect(getSourcePath(wrapped)).toBeUndefined()
    expect(getSourcePath(wrapped.children[0])).toEqual([0])
    expect(getSourcePath(wrapped.children[0].children[0])).toEqual([0, 0])
  })

  it('tags a code block node by its fence line', () => {
    const source = parseSource('# Root\n```\ncode\n```')
    const root = withLines(mm('Root', [withLines(mm('<pre>code</pre>'), '1,4')]), '0,1')
    tagSourcePaths(root, source)

    expect(getSourcePath(root.children[0])).toEqual([0, 0])
  })

  it('tags a table node by its first row', () => {
    const source = parseSource('# Root\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    const root = withLines(mm('Root', [withLines(mm('<table>…</table>'), '2,5')]), '0,2')
    tagSourcePaths(root, source)

    expect(getSourcePath(root.children[0])).toEqual([0, 0])
  })
})

describe('normalization', () => {
  it('strips html tags and comments from rendered content', () => {
    expect(normalizeContent('<strong>bold</strong>')).toBe('bold')
    expect(normalizeContent('<code>x</code>')).toBe('x')
    expect(normalizeContent('text <!--color: red-->')).toBe('text')
    expect(normalizeContent('<svg width="16"><path d="M0 0"/></svg> done')).toBe('done')
  })

  it('strips inline markdown from source text', () => {
    expect(normalizeText('**bold**')).toBe('bold')
    expect(normalizeText('`code`')).toBe('code')
    expect(normalizeText('[text](url)')).toBe('text')
    expect(normalizeText('[[link|text]]')).toBe('text')
    expect(normalizeText('[[link]]')).toBe('link')
    expect(normalizeText('text <!--color: red-->')).toBe('text')
  })

  it('makes equivalent source and rendered text match', () => {
    expect(normalizeText('[link](url)')).toBe(normalizeContent('<a href="url">link</a>'))
    expect(normalizeText('**bold**')).toBe(normalizeContent('<strong>bold</strong>'))
  })

  it('decodes numeric html entities', () => {
    expect(normalizeContent('&#x5b8c;&#x6210;')).toBe('完成')
    expect(normalizeContent('&#23436;&#25104;')).toBe('完成')
    expect(normalizeContent('&#x2265;')).toBe('≥')
  })

  it('strips the ordered list index markmap adds', () => {
    expect(normalizeContent('1. hello')).toBe('hello')
    expect(normalizeContent('12. hello')).toBe('hello')
  })

  it('strips markdown highlight syntax', () => {
    expect(normalizeText('==highlight==')).toBe('highlight')
    expect(normalizeText('*==TODO==*')).toBe('TODO')
  })

  it('matches an entity-encoded ordered item against its source line', () => {
    expect(normalizeText('完成 AI Infra')).toBe(normalizeContent('1. &#x5b8c;&#x6210; AI Infra'))
  })
})
