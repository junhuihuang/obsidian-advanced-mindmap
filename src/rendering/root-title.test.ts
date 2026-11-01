import type { IPureNode } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import { describe, expect, it } from 'vitest'

import { getSourcePath, tagSourcePaths } from 'src/editing/source-paths'
import { parseSource } from 'src/editing/source-tree'
import { addTitleToRootNode, expandLevelWithTitle } from './root-title'


const transformer = new Transformer()

function node(content: string, children: IPureNode[] = []): IPureNode {
  return { content, children, payload: {} }
}

/** Every node whose text is `text`, in render order. */
function nodesWithContent(root: IPureNode, text: string): IPureNode[] {
  const found: IPureNode[] = []
  const walk = (current: IPureNode) => {
    if (current.content === text) found.push(current)
    current.children.forEach(walk)
  }
  walk(root)
  return found
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

  it('names a root that markmap filled from the frontmatter title in place', () => {
    // Several top-level headings: markmap's root is a synthetic container, and
    // it writes the frontmatter `title:` into it because it has no text.
    const markdown = '---\ntitle: My note\n---\n\n## A\n\n## B\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    expect(root.content).toBe('My note')
    expect(getSourcePath(root)).toEqual([])

    const titled = addTitleToRootNode(root, 'My note')

    // No wrapper: the note's name would be drawn twice, and the wrapper would
    // share the empty source path with the document root.
    expect(titled).toBe(root)
    expect(nodesWithContent(titled, 'My note')).toEqual([root])
  })

  it('names a list-wrapper root that carries the frontmatter title in place', () => {
    const markdown = '---\ntitle: My note\n---\n\n- a\n- b\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    // markmap's root is the top-level list wrapper, which the frontmatter title
    // named. It is still not a node of the document.
    expect(root.content).toBe('My note')
    expect(getSourcePath(root)).toEqual([])

    const titled = addTitleToRootNode(root, 'My note')

    expect(titled).toBe(root)
    expect(nodesWithContent(titled, 'My note')).toEqual([root])
  })

  it('keeps a frontmatter title as the root when the note name differs', () => {
    const markdown = '---\ntitle: My note\n---\n\n## A\n\n## B\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const titled = addTitleToRootNode(root, '2026-11-01')

    // The document's own title is more accurate than the file name, and the
    // root is render-only either way.
    expect(titled).toBe(root)
    expect(titled.content).toBe('My note')
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
