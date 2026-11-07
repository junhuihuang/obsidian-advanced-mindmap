// @vitest-environment jsdom
import type { IPureNode } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import { describe, expect, it } from 'vitest'

import { SOURCE_PATH_KEY, tagSourcePaths } from 'src/editing/source-paths'
import { parseSource } from 'src/editing/source-tree'
import { insertProseNodes } from './prose-nodes'
import { applyHeadingLevels, HEADING_LEVEL_ATTR, tagHeadingLevels } from './node-headings'


const SVG_NS = 'http://www.w3.org/2000/svg'
const transformer = new Transformer()

function render(markdown: string): IPureNode {
  const { root } = transformer.transform(markdown)
  const roots = parseSource(markdown)
  tagSourcePaths(root, roots)
  insertProseNodes(root, roots, text => transformer.md.renderInline(text))
  tagHeadingLevels(root, roots)
  return root
}

/** Text and tagged heading level of every node with text, in document order. */
function levels(root: IPureNode): [string, unknown][] {
  const found: [string, unknown][] = []
  const visit = (node: IPureNode) => {
    if (node.content !== '')
      found.push([node.content.replace(/<[^>]*>/g, '').trim(), node.payload?.advmmHeadingLevel])
    for (const child of node.children) visit(child)
  }
  visit(root)
  return found
}

function makeGroup(payload: Record<string, unknown>): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  ;(group as unknown as { __data__: unknown }).__data__ = { payload }
  return group as unknown as SVGGElement
}

describe('tagHeadingLevels', () => {
  it('tags headings with their level and leaves lists and prose alone', () => {
    // The lists come after the last heading: markmap drops list items that are
    // followed by a heading of another level (see lessons/markdown-parsing.md).
    const root = render([
      '# Title',
      '',
      '## Section',
      '',
      '### Deeper',
      '',
      'A plain paragraph.',
      '',
      '- bullet one',
      '',
      '1. first',
      '',
      '- [ ] open',
    ].join('\n'))

    expect(levels(root)).toEqual([
      ['Title', 1],
      ['Section', 2],
      ['Deeper', 3],
      ['A plain paragraph.', undefined],
      ['bullet one', undefined],
      ['1. first', undefined],
      ['open', undefined],
    ])
  })

  it('never tags a container: a path without text is not a node to size', () => {
    const container: IPureNode = {
      content: '',
      children: [{ content: 'Title', children: [], payload: { [SOURCE_PATH_KEY]: [0] } }],
      payload: { [SOURCE_PATH_KEY]: [0] },
    }

    tagHeadingLevels(container, parseSource('# Title\n\n- a\n'))

    expect(container.payload?.advmmHeadingLevel).toBeUndefined()
    expect(container.children[0].payload?.advmmHeadingLevel).toBe(1)
  })
})

describe('applyHeadingLevels', () => {
  it('writes the level as an attribute', () => {
    const group = makeGroup({ advmmHeadingLevel: 3 })

    applyHeadingLevels([group])

    expect(group.getAttribute(HEADING_LEVEL_ATTR)).toBe('3')
  })

  it('follows a level change and clears it when the node is no longer a heading', () => {
    const group = makeGroup({ advmmHeadingLevel: 1 })
    applyHeadingLevels([group])

    ;(group as unknown as { __data__: unknown }).__data__ = { payload: { advmmHeadingLevel: 4 } }
    applyHeadingLevels([group])
    expect(group.getAttribute(HEADING_LEVEL_ATTR)).toBe('4')

    ;(group as unknown as { __data__: unknown }).__data__ = { payload: {} }
    applyHeadingLevels([group])
    expect(group.hasAttribute(HEADING_LEVEL_ATTR)).toBe(false)
  })

  it('ignores an out-of-range level', () => {
    const group = makeGroup({ advmmHeadingLevel: 7 })

    applyHeadingLevels([group])

    expect(group.hasAttribute(HEADING_LEVEL_ATTR)).toBe(false)
  })
})
