import type { IPureNode } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import { describe, expect, it } from 'vitest'

import { getSourcePath, normalizeContent, tagSourcePaths } from 'src/editing/source-paths'
import { parseSource } from 'src/editing/source-tree'
import { parseInternalLinks } from 'src/internal-links/parse-internal-links'
import { insertProseNodes } from './prose-nodes'


const transformer = new Transformer()

function render(markdown: string): IPureNode {
  const { root } = transformer.transform(markdown)
  const roots = parseSource(markdown)
  tagSourcePaths(root, roots)
  insertProseNodes(root, roots, text => transformer.md.renderInline(text))
  parseInternalLinks(root)
  return root
}

function children(node: IPureNode) {
  return node.children.map(child => ({
    text: normalizeContent(child.content),
    path: getSourcePath(child),
    children: child.children.map(grandchild => ({
      text: normalizeContent(grandchild.content),
      path: getSourcePath(grandchild),
    })),
  }))
}

describe('prose paragraphs as parents', () => {
  it('turns a paragraph before a list into a node with the list items as children', () => {
    const root = render('下午临时参加了汇报。\n- 世界模型\n- AI Infra\n')

    expect(children(root)).toEqual([
      {
        text: '下午临时参加了汇报。',
        path: [0],
        children: [
          { text: '世界模型', path: [0, 0] },
          { text: 'AI Infra', path: [0, 1] },
        ],
      },
    ])
  })

  it('works below a heading', () => {
    const root = render('# Root\nP\n- a\n- b\n')

    expect(normalizeContent(root.content)).toBe('Root')
    expect(children(root)).toEqual([
      {
        text: 'P',
        path: [0, 0],
        children: [
          { text: 'a', path: [0, 0, 0] },
          { text: 'b', path: [0, 0, 1] },
        ],
      },
    ])
  })

  it('keeps separate paragraphs as separate parents', () => {
    const root = render('First.\n- a\n\nSecond.\n1. b\n')

    expect(children(root)).toEqual([
      {
        text: 'First.',
        path: [0],
        children: [{ text: 'a', path: [0, 0] }],
      },
      {
        text: 'Second.',
        path: [1],
        children: [{ text: 'b', path: [1, 0] }],
      },
    ])
  })

  it('turns a paragraph before a code block into a node', () => {
    const root = render('# Root\nP\n```\nconst x = 1\n```\n')

    expect(children(root)).toEqual([
      {
        text: 'P',
        path: [0, 0],
        children: [{ text: 'const x = 1', path: [0, 0, 0] }],
      },
    ])
  })

  it('renders plain prose as nodes even without a renderable block', () => {
    const root = render('Just a paragraph.\n\nAnother paragraph.\n')

    expect(normalizeContent(root.content)).toBe('')
    expect(children(root)).toEqual([
      { text: 'Just a paragraph.', path: [0], children: [] },
      { text: 'Another paragraph.', path: [1], children: [] },
    ])
  })

  it('keeps top-level prose before a single rendered branch', () => {
    const root = render('P0\n\nP1\n- a\n')

    expect(children(root)).toEqual([
      { text: 'P0', path: [0], children: [] },
      {
        text: 'P1',
        path: [1],
        children: [{ text: 'a', path: [1, 0] }],
      },
    ])
  })

  it('keeps prose below a heading without requiring a list', () => {
    const root = render('# Root\n\nP\n')

    expect(normalizeContent(root.content)).toBe('Root')
    expect(children(root)).toEqual([
      { text: 'P', path: [0, 0], children: [] },
    ])
  })

  it('keeps a single plain paragraph as a node', () => {
    const root = render('Only one paragraph.\n')

    expect(normalizeContent(root.content)).toBe('')
    expect(children(root)).toEqual([
      { text: 'Only one paragraph.', path: [0], children: [] },
    ])
  })

  it('renders a prose-only note as three top-level nodes', () => {
    const root = render('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n')

    expect(children(root)).toEqual([
      { text: 'First paragraph.', path: [0], children: [] },
      { text: 'Second paragraph.', path: [1], children: [] },
      { text: 'Third paragraph.', path: [2], children: [] },
    ])
  })

  it('keeps prose after a list in source order', () => {
    const root = render('- a\n\nAfter the list.\n')

    expect(children(root)).toEqual([
      { text: 'a', path: [0], children: [] },
      { text: 'After the list.', path: [1], children: [] },
    ])
  })

  it('renders inline markdown and wikilinks in the paragraph', () => {
    const root = render('See [[金字塔思维]] and **bold**.\n- item\n')

    // A single child is collapsed by markmap into the root, so the paragraph
    // becomes the root and the list item its child.
    expect(normalizeContent(root.content)).toBe('See 金字塔思维 and bold.')
    expect(root.content).toContain('<a href="金字塔思维">金字塔思维</a>')
    expect(root.content).toContain('<strong>bold</strong>')
    expect(normalizeContent(root.children[0].content)).toBe('item')
  })
})
