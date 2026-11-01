import { describe, expect, it } from 'vitest'

import {
  applyEdit,
  extractSubtree,
  getNodeAtPath,
  insertSubtree,
  moveNode,
  moveNodes,
  parseSource,
  pathKey,
  removeSubtree,
  rootChildTarget,
  samePath,
  serializeSource,
  type SourceNode,
} from './source-tree'


/** Compact outline of a source tree, for readable structural assertions. */
function outline(nodes: SourceNode[]): unknown[] {
  return nodes.map(node => [node.text, ...outline(node.children)])
}

describe('parseSource', () => {
  it('returns no nodes for an empty document', () => {
    expect(parseSource('')).toEqual([])
  })

  it('parses a single heading', () => {
    const nodes = parseSource('# Root')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      kind: 'heading',
      level: 1,
      marker: '#',
      indent: 0,
      checkbox: null,
      text: 'Root',
      line: 0,
      endLine: 0,
    })
    expect(nodes[0].children).toEqual([])
  })

  it('nests headings by level', () => {
    const markdown = [
      '# Root',
      '## A',
      '## B',
      '### B1',
    ].join('\n')

    const nodes = parseSource(markdown)
    expect(outline(nodes)).toEqual([
      ['Root', ['A'], ['B', ['B1']]],
    ])
  })

  it('tracks line and subtree end line', () => {
    const markdown = [
      '# Root',
      '## A',
      '## B',
      '### B1',
    ].join('\n')

    const [root] = parseSource(markdown)
    expect(root.line).toBe(0)
    expect(root.endLine).toBe(3)

    const [a, b] = root.children
    expect(a.line).toBe(1)
    expect(a.endLine).toBe(1)
    expect(b.line).toBe(2)
    expect(b.endLine).toBe(3)
    expect(b.children[0].line).toBe(3)
    expect(b.children[0].endLine).toBe(3)
  })

  it('nests bullet lists by indentation', () => {
    const markdown = [
      '- a',
      '  - a1',
      '  - a2',
      '- b',
    ].join('\n')

    const nodes = parseSource(markdown)
    expect(outline(nodes)).toEqual([
      ['a', ['a1'], ['a2']],
      ['b'],
    ])
    expect(nodes[0].kind).toBe('list')
    expect(nodes[0].indent).toBe(0)
    expect(nodes[0].children[0].indent).toBe(2)
  })

  it('nests lists under headings', () => {
    const markdown = [
      '# Root',
      '- a',
      '  - a1',
      '- b',
    ].join('\n')

    const nodes = parseSource(markdown)
    expect(outline(nodes)).toEqual([
      ['Root', ['a', ['a1']], ['b']],
    ])
    const [root] = nodes
    expect(root.endLine).toBe(3)
    expect(root.children[0].endLine).toBe(2)
    expect(root.children[1].endLine).toBe(3)
  })

  it('parses checkboxes', () => {
    const markdown = [
      '- [x] done',
      '- [ ] todo',
      '- [X] also done',
    ].join('\n')

    const nodes = parseSource(markdown)
    expect(nodes.map(n => [n.checkbox, n.text])).toEqual([
      ['x', 'done'],
      [' ', 'todo'],
      ['x', 'also done'],
    ])
  })

  it('parses ordered list markers', () => {
    const nodes = parseSource('1. one\n2. two')
    expect(nodes.map(n => [n.marker, n.text])).toEqual([
      ['1.', 'one'],
      ['2.', 'two'],
    ])
  })

  it('does not treat emphasis or horizontal rules as list items', () => {
    expect(outline(parseSource('*emphasis*'))).toEqual([['*emphasis*']])
    expect(parseSource('---')).toEqual([])
    expect(parseSource('***')).toEqual([])
  })

  it('keeps a fenced code block as a single node', () => {
    const markdown = [
      '# Root',
      '```',
      '# not a heading',
      '- not a list',
      '```',
      '- real',
    ].join('\n')

    const nodes = parseSource(markdown)
    // The block is one node: its content is never parsed as a heading or list.
    expect(outline(nodes)).toEqual([
      ['Root', ['# not a heading\n- not a list'], ['real']],
    ])
    expect(nodes[0].children[0]).toMatchObject({
      kind: 'code',
      marker: '```',
      indent: 0,
      line: 1,
      endLine: 4,
    })
    expect(nodes[0].children[0].raw).toEqual(['```', '# not a heading', '- not a list', '```'])
    expect(nodes[0].endLine).toBe(5)
  })

  it('keeps an info string on the fence', () => {
    const nodes = parseSource('```js\nconst x = 1\n```')
    expect(nodes[0]).toMatchObject({ kind: 'code', marker: '```', line: 0, endLine: 2 })
    expect(nodes[0].raw?.[0]).toBe('```js')
    expect(nodes[0].text).toBe('const x = 1')
  })

  it('nests an indented code block under its list item', () => {
    const markdown = ['- a', '  ```', '  code', '  ```', '- b'].join('\n')
    expect(outline(parseSource(markdown))).toEqual([
      ['a', ['code']],
      ['b'],
    ])
    const code = parseSource(markdown)[0].children[0]
    expect(code.kind).toBe('code')
    expect(code.indent).toBe(2)
  })

  it('treats an unterminated fence as a block to the end of the file', () => {
    const nodes = parseSource('```\ncode')
    expect(nodes[0]).toMatchObject({ kind: 'code', line: 0, endLine: 1 })
    expect(nodes[0].raw).toEqual(['```', 'code'])
  })

  it('keeps a table as a single node', () => {
    const markdown = ['# Root', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '- x'].join('\n')
    const nodes = parseSource(markdown)
    expect(outline(nodes)).toEqual([
      ['Root', ['| a | b |\n|---|---|\n| 1 | 2 |'], ['x']],
    ])
    expect(nodes[0].children[0]).toMatchObject({ kind: 'table', line: 2, endLine: 4 })
    expect(nodes[0].children[0].raw).toEqual(['| a | b |', '|---|---|', '| 1 | 2 |'])
  })

  it('does not treat a horizontal rule or blockquote as a table', () => {
    expect(parseSource('---')).toEqual([])
    expect(outline(parseSource('| not a table |'))).toEqual([['| not a table |']])
    expect(parseSource('> | a |\n> |---|')).toEqual([])
  })

  it('preserves inline html comments in text', () => {
    const nodes = parseSource('- item <!--color: red-->')
    expect(nodes[0].text).toBe('item <!--color: red-->')
  })

  it('ignores frontmatter, including list-like lines', () => {
    const markdown = [
      '---',
      'tags:',
      '  - foo',
      '  - bar',
      '---',
      '# Root',
      '- a',
    ].join('\n')

    const nodes = parseSource(markdown)
    expect(outline(nodes)).toEqual([
      ['Root', ['a']],
    ])
    expect(nodes[0].line).toBe(5)
    expect(nodes[0].endLine).toBe(6)
  })

  it('ignores frontmatter closed with dots', () => {
    const markdown = [
      '---',
      '- not a node',
      '...',
      '# Root',
    ].join('\n')

    expect(outline(parseSource(markdown))).toEqual([['Root']])
  })

  it('treats an unterminated frontmatter block as empty', () => {
    const markdown = [
      '---',
      'title: hello',
      '- not a node',
    ].join('\n')

    expect(parseSource(markdown)).toEqual([])
  })
})

describe('prose paragraph nodes', () => {
  it('parses a paragraph before a list as the list items parent', () => {
    expect(outline(parseSource('Intro\n- a\n- b'))).toEqual([
      ['Intro', ['a'], ['b']],
    ])
  })

  it('keeps a blank line between the paragraph and its list', () => {
    expect(outline(parseSource('Intro\n\n- a'))).toEqual([
      ['Intro', ['a']],
    ])
  })

  it('keeps standalone prose as nodes', () => {
    expect(outline(parseSource('Just prose.\n\nMore prose.'))).toEqual([
      ['Just prose.'],
      ['More prose.'],
    ])
  })

  it('does not turn a list item continuation into a paragraph node', () => {
    expect(outline(parseSource('- item\n  continuation'))).toEqual([
      ['item'],
    ])
  })

  it('can rename a paragraph without touching its children', () => {
    expect(applyEdit('Intro\n- a', { type: 'setText', path: [0], text: 'New intro' }))
      .toBe('New intro\n- a')
  })

  it('can add a child to the paragraph block', () => {
    expect(applyEdit('Intro\n- a', { type: 'addChild', path: [0], text: 'b' }))
      .toBe('Intro\n- a\n- b')
  })

  it('removes the paragraph together with its block', () => {
    expect(applyEdit('Intro\n- a\n- b\n\nAfter', { type: 'remove', path: [0] }))
      .toBe('\nAfter')
  })
})


describe('serializeSource', () => {
  it('round trips nested headings', () => {
    const markdown = [
      '# Root',
      '## A',
      '### A1',
      '## B',
    ].join('\n')

    expect(serializeSource(parseSource(markdown))).toBe(markdown)
  })

  it('round trips nested bullet lists', () => {
    const markdown = [
      '- a',
      '  - a1',
      '    - a1x',
      '- b',
    ].join('\n')

    expect(serializeSource(parseSource(markdown))).toBe(markdown)
  })

  it('round trips checkboxes and ordered lists', () => {
    const markdown = [
      '1. one',
      '2. [x] two',
      '- [ ] three',
    ].join('\n')

    expect(serializeSource(parseSource(markdown))).toBe(markdown)
  })

  it('round trips tab indentation', () => {
    const markdown = [
      '1. a',
      '\t1. b',
      '\t\t1. c',
    ].join('\n')

    expect(serializeSource(parseSource(markdown))).toBe(markdown)
  })

  it('round trips a mixed heading/list document', () => {
    const markdown = [
      '# Root',
      '- a',
      '  - a1',
      '## B',
      '### B1',
    ].join('\n')

    expect(serializeSource(parseSource(markdown))).toBe(markdown)
  })

  it('round trips a code block and a table', () => {
    const markdown = [
      '# Root',
      '```js',
      'const x = 1',
      '```',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '- a',
    ].join('\n')

    expect(serializeSource(parseSource(markdown))).toBe(markdown)
  })
})

describe('getNodeAtPath', () => {
  const markdown = '# Root\n## A\n- a1\n## B'

  it('resolves a node by path', () => {
    const roots = parseSource(markdown)
    expect(getNodeAtPath(roots, [0]).text).toBe('Root')
    expect(getNodeAtPath(roots, [0, 0]).text).toBe('A')
    expect(getNodeAtPath(roots, [0, 0, 0]).text).toBe('a1')
    expect(getNodeAtPath(roots, [0, 1]).text).toBe('B')
  })

  it('throws on an invalid path', () => {
    const roots = parseSource(markdown)
    expect(() => getNodeAtPath(roots, [])).toThrow()
    expect(() => getNodeAtPath(roots, [9])).toThrow()
    expect(() => getNodeAtPath(roots, [0, 0, 0, 0])).toThrow()
  })
})

describe('applyEdit setText', () => {
  it('replaces heading text preserving the level', () => {
    const result = applyEdit('# Root\n## A', {
      type: 'setText',
      path: [0, 0],
      text: 'Renamed',
    })
    expect(result).toBe('# Root\n## Renamed')
  })

  it('preserves list marker, indentation and checkbox', () => {
    const markdown = [
      '# Root',
      '- [x] done',
      '  - nested',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'setText',
      path: [0, 0],
      text: 'updated',
    })
    expect(result).toBe([
      '# Root',
      '- [x] updated',
      '  - nested',
    ].join('\n'))
  })

  it('preserves the trailing inline comment when re-added', () => {
    const result = applyEdit('- item <!--color: red-->', {
      type: 'setText',
      path: [0],
      text: 'item <!--color: blue-->',
    })
    expect(result).toBe('- item <!--color: blue-->')
  })

  it('preserves tab indentation', () => {
    const markdown = '1. a\n\t1. b'
    const result = applyEdit(markdown, {
      type: 'setText',
      path: [0, 0],
      text: 'renamed',
    })
    expect(result).toBe('1. a\n\t1. renamed')
  })

  it('replaces a code block body keeping the fences and info string', () => {
    const markdown = ['# Root', '```js', 'old', 'more', '```', '- a'].join('\n')
    const result = applyEdit(markdown, { type: 'setText', path: [0, 0], text: 'new line\nsecond' })
    expect(result).toBe(['# Root', '```js', 'new line', 'second', '```', '- a'].join('\n'))
  })

  it('replaces an indented code block body keeping the indentation', () => {
    const markdown = ['- a', '  ```', '  old', '  ```'].join('\n')
    const result = applyEdit(markdown, { type: 'setText', path: [0, 0], text: 'new' })
    expect(result).toBe(['- a', '  ```', '  new', '  ```'].join('\n'))
  })

  it('replaces a table with the raw rows', () => {
    const markdown = ['| a |', '|---|', '| 1 |'].join('\n')
    const result = applyEdit(markdown, { type: 'setText', path: [0], text: '| b |\n|---|\n| 2 |' })
    expect(result).toBe(['| b |', '|---|', '| 2 |'].join('\n'))
  })
})

describe('applyEdit addChild', () => {
  it('adds a heading child to a heading', () => {
    const result = applyEdit('# Root', {
      type: 'addChild',
      path: [0],
      text: 'Child',
    })
    expect(result).toBe('# Root\n## Child')
  })

  it('adds a list child under a list item', () => {
    const result = applyEdit('- a', {
      type: 'addChild',
      path: [0],
      text: 'a1',
    })
    expect(result).toBe('- a\n  - a1')
  })

  it('adds a child after the whole existing subtree', () => {
    const markdown = [
      '# Root',
      '## A',
      '### A1',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'B',
    })
    expect(result).toBe([
      '# Root',
      '## A',
      '### A1',
      '## B',
    ].join('\n'))
  })

  it('falls back to a list item when the heading is level 6', () => {
    const result = applyEdit('###### Deep', {
      type: 'addChild',
      path: [0],
      text: 'Child',
    })
    expect(result).toBe('###### Deep\n- Child')
  })

  it('adds a nested ordered item under an ordered list (3-space marker width)', () => {
    const result = applyEdit('1. one', {
      type: 'addChild',
      path: [0],
      text: 'one-one',
    })
    expect(result).toBe('1. one\n   1. one-one')
  })

  it('uses four spaces for wide ordered markers', () => {
    const result = applyEdit('10. ten', {
      type: 'addChild',
      path: [0],
      text: 'child',
    })
    expect(result).toBe('10. ten\n    1. child')
  })

  it('uses a tab when the document is tab indented', () => {
    const markdown = '1. a\n\t1. b'
    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'child',
    })
    expect(result).toBe('1. a\n\t1. b\n\t2. child')
  })

  it('nests under a tab-indented parent with a tab', () => {
    const markdown = '1. a\n\t1. b'
    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0, 0],
      text: 'child',
    })
    expect(result).toBe('1. a\n\t1. b\n\t\t1. child')
  })

  it('matches the indentation of the existing children', () => {
    const markdown = '1. a\n    1. b'
    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'c',
    })
    expect(result).toBe('1. a\n    1. b\n    2. c')
  })

  it('adds a list child below a code block', () => {
    const markdown = ['```', 'code', '```'].join('\n')
    const result = applyEdit(markdown, { type: 'addChild', path: [0], text: 'child' })
    expect(parseSource(result)[0].children.map(node => node.text)).toEqual(['child'])
  })
})

describe('applyEdit addChild to the synthetic root', () => {
  // The markmap root is synthetic (source path `[]`) whenever the document has
  // no single top-level node: prose only, a flat list, or several headings.
  // `addChild` on it must still add a node, as a new top-level one.
  it('appends a list item to a prose-only document', () => {
    const result = applyEdit('> 从外部视角审视自己的工作\n', {
      type: 'addChild',
      path: [],
      text: 'New node',
    })
    expect(result).toBe('> 从外部视角审视自己的工作\n- New node\n')
  })

  it('adds a top-level paragraph when the last root is prose', () => {
    const markdown = 'Intro\n- a\n'
    expect(rootChildTarget(markdown)).toEqual({ line: 2, path: [1] })
    expect(applyEdit(markdown, { type: 'addChild', path: [], text: 'New node' }))
      .toBe('Intro\n- a\n\nNew node\n')
  })

  it('bootstraps an empty document', () => {
    const result = applyEdit('', { type: 'addChild', path: [], text: 'New node' })
    expect(result).toBe('- New node\n')
  })

  it('appends a sibling of the last top-level item of a flat list', () => {
    const result = applyEdit('- a\n- b\n', { type: 'addChild', path: [], text: 'c' })
    expect(result).toBe('- a\n- b\n- c\n')
  })

  it('matches the marker of the last top-level node', () => {
    const result = applyEdit('* a\n* b\n', { type: 'addChild', path: [], text: 'c' })
    expect(result).toBe('* a\n* b\n* c\n')
  })

  it('appends a heading sibling when the roots are headings', () => {
    const result = applyEdit('# A\n# B\n', { type: 'addChild', path: [], text: 'C' })
    expect(result).toBe('# A\n# B\n# C\n')
  })

  it('keeps the trailing blank lines after the last top-level node', () => {
    const result = applyEdit('- a\n\npara\n', { type: 'addChild', path: [], text: 'b' })
    expect(result).toBe('- a\n\npara\n\nb\n')
  })

  it('renumbers an ordered top-level list from 1', () => {
    const result = applyEdit('1. a\n2. b\n', { type: 'addChild', path: [], text: 'c' })
    expect(result).toBe('1. a\n2. b\n3. c\n')
  })

  it('appends inside a subtree-less document with frontmatter', () => {
    const markdown = '---\ntags: [x]\n---\n> note\n'
    const result = applyEdit(markdown, { type: 'addChild', path: [], text: 'New node' })
    expect(result).toBe('---\ntags: [x]\n---\n> note\n- New node\n')
  })

  // A document with no node of its own shows the file title as its root; the new
  // node simply becomes the document's first top-level node. The renderer keeps
  // the title above it (see `root-title.ts`), so nothing is written for it.
  it('appends a top-level node when the document has none', () => {
    const result = applyEdit('> note\n', { type: 'addChild', path: [], text: 'child' })
    expect(result).toBe('> note\n- child\n')
  })

  it('bootstraps an empty document', () => {
    const result = applyEdit('', { type: 'addChild', path: [], text: 'child' })
    expect(result).toBe('- child\n')
  })
})

describe('rootChildTarget', () => {
  it('points at the appended top-level node of a flat list', () => {
    expect(rootChildTarget('- a\n- b\n')).toEqual({ line: 2, path: [2] })
  })

  it('points at the first top-level node of a node-less document', () => {
    expect(rootChildTarget('> note\n')).toEqual({ line: 1, path: [0] })
  })

  it('agrees with applyEdit', () => {
    for (const markdown of ['> note\n', '', '- a\n- b\n', '# A\n# B\n']) {
      const target = rootChildTarget(markdown)
      const after = applyEdit(markdown, { type: 'addChild', path: [], text: 'x' })
      const node = getNodeAtPath(parseSource(after), target.path)
      expect(node.text).toBe('x')
      expect(node.line).toBe(target.line)
    }
  })
})

describe('applyEdit addSibling', () => {
  it('adds a list sibling after a code block', () => {
    const markdown = ['# Root', '```', 'code', '```'].join('\n')
    const result = applyEdit(markdown, { type: 'addSibling', path: [0, 0], text: 'next' })
    expect(result).toBe(['# Root', '```', 'code', '```', '- next'].join('\n'))
  })

  it('adds a heading sibling with the same level', () => {
    const markdown = [
      '# Root',
      '## A',
      '## B',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [0, 0],
      text: 'New',
    })
    expect(result).toBe([
      '# Root',
      '## A',
      '## New',
      '## B',
    ].join('\n'))
  })

  it('adds a list sibling with the same marker and indentation', () => {
    const markdown = [
      '- a',
      '  - a1',
      '- b',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [0, 0],
      text: 'a2',
    })
    expect(result).toBe([
      '- a',
      '  - a1',
      '  - a2',
      '- b',
    ].join('\n'))
  })

  it('adds a root level sibling', () => {
    const result = applyEdit('- a', {
      type: 'addSibling',
      path: [0],
      text: 'b',
    })
    expect(result).toBe('- a\n- b')
  })

  it('preserves tab indentation for a sibling', () => {
    const markdown = '1. a\n\t1. b'
    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [0, 0],
      text: 'b2',
    })
    expect(result).toBe('1. a\n\t1. b\n\t2. b2')
  })
})

describe('applyEdit renumbers ordered lists', () => {
  it('renumbers children when adding a child', () => {
    const markdown = '1. a\n    1. b'
    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'c',
    })
    expect(result).toBe('1. a\n    1. b\n    2. c')
  })

  it('renumbers the following siblings when adding a sibling', () => {
    const markdown = '1. a\n2. b\n3. c'
    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [1],
      text: 'new',
    })
    expect(result).toBe('1. a\n2. b\n3. new\n4. c')
  })

  it('renumbers top level items', () => {
    const markdown = '1. a\n2. b'
    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [0],
      text: 'new',
    })
    expect(result).toBe('1. a\n2. new\n3. b')
  })

  it('renumbers after removing an item', () => {
    const markdown = '1. a\n2. b\n3. c'
    const result = applyEdit(markdown, {
      type: 'remove',
      path: [1],
    })
    expect(result).toBe('1. a\n2. c')
  })

  it('renumbers from 1 even when the list started higher', () => {
    const markdown = '3. a\n4. b'
    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [1],
      text: 'new',
    })
    expect(result).toBe('1. a\n2. b\n3. new')
  })

  it('renumbers the remaining children from 1 after deleting the first child', () => {
    const markdown = '4. parent\n    1. a\n    2. b\n    3. c'
    const result = applyEdit(markdown, {
      type: 'remove',
      path: [0, 0],
    })
    expect(result).toBe('4. parent\n    1. b\n    2. c')
  })

  it('does not renumber bullet lists', () => {
    const markdown = '- a\n- b'
    const result = applyEdit(markdown, {
      type: 'addSibling',
      path: [0],
      text: 'new',
    })
    expect(result).toBe('- a\n- new\n- b')
  })

  it('renumbers when editing the text of an item', () => {
    const markdown = '1. a\n1. b\n1. c'
    const result = applyEdit(markdown, {
      type: 'setText',
      path: [1],
      text: 'renamed',
    })
    expect(result).toBe('1. a\n2. renamed\n3. c')
  })

  it('preserves indentation while renumbering', () => {
    const markdown = '1. a\n\t1. b'
    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'c',
    })
    expect(result).toBe('1. a\n\t1. b\n\t2. c')
  })
})

describe('applyEdit remove', () => {
  it('removes a leaf node', () => {
    const result = applyEdit('- a\n- b\n- c', {
      type: 'remove',
      path: [1],
    })
    expect(result).toBe('- a\n- c')
  })

  it('removes a node together with its subtree', () => {
    const markdown = [
      '# Root',
      '## A',
      '### A1',
      '## B',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'remove',
      path: [0, 0],
    })
    expect(result).toBe([
      '# Root',
      '## B',
    ].join('\n'))
  })

  it('removes a whole code block', () => {
    const markdown = ['# Root', '```', 'code', '```', '- a'].join('\n')
    const result = applyEdit(markdown, { type: 'remove', path: [0, 0] })
    expect(result).toBe(['# Root', '- a'].join('\n'))
  })
})

describe('applyEdit preserves unrelated content', () => {
  it('keeps frontmatter intact', () => {
    const markdown = [
      '---',
      'markmap:',
      '  color: red',
      '---',
      '# Root',
      '- a',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'setText',
      path: [0, 0],
      text: 'updated',
    })
    expect(result).toBe([
      '---',
      'markmap:',
      '  color: red',
      '---',
      '# Root',
      '- updated',
    ].join('\n'))
  })

  it('keeps list-like frontmatter lines intact', () => {
    const markdown = [
      '---',
      'tags:',
      '  - foo',
      '  - bar',
      '---',
      '# Root',
      '- a',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'b',
    })
    expect(result).toBe([
      '---',
      'tags:',
      '  - foo',
      '  - bar',
      '---',
      '# Root',
      '- a',
      '## b',
    ].join('\n'))
  })

  it('keeps paragraph lines that are not mindmap nodes', () => {
    const markdown = [
      '# Root',
      'some paragraph',
      '- a',
    ].join('\n')

    const result = applyEdit(markdown, {
      type: 'addChild',
      path: [0],
      text: 'b',
    })
    expect(result).toBe([
      '# Root',
      'some paragraph',
      '- a',
      '## b',
    ].join('\n'))
  })

  it('keeps a trailing newline', () => {
    const result = applyEdit('# Root\n', {
      type: 'addChild',
      path: [0],
      text: 'Child',
    })
    expect(result).toBe('# Root\n## Child\n')
  })

  it('throws when the path does not exist', () => {
    expect(() => applyEdit('# Root', {
      type: 'setText',
      path: [3],
      text: 'x',
    })).toThrow()
  })
})

describe('moveNode', () => {
  const moved = (markdown: string, source: number[], target: number[], position?: 'before' | 'after' | 'child') =>
    moveNode(markdown, source, target, position).markdown

  it('moves a list item (with its subtree) into an empty heading', () => {
    const markdown = [
      '## part-001',
      '1. one',
      '2. two',
      '    1. two-a',
      '3. three',
      '',
      '## block2',
    ].join('\n')

    expect(moved(markdown, [0, 1], [1])).toBe([
      '## part-001',
      '1. one',
      '2. three',
      '',
      '## block2',
      '1. two',
      '    1. two-a',
    ].join('\n'))
  })

  it('renumbers the ordered list it moves into', () => {
    const markdown = ['## a', '1. x', '2. y', '## b', '1. p'].join('\n')

    expect(moved(markdown, [0, 1], [1])).toBe([
      '## a',
      '1. x',
      '## b',
      '1. p',
      '2. y',
    ].join('\n'))
  })

  it('moves a node before its earlier sibling', () => {
    const markdown = ['- a', '- b', '- c'].join('\n')
    expect(moved(markdown, [2], [0], 'before')).toBe(['- c', '- a', '- b'].join('\n'))
  })

  it('moves a node after its later sibling', () => {
    const markdown = ['- a', '- b', '- c'].join('\n')
    expect(moved(markdown, [0], [2], 'after')).toBe(['- b', '- c', '- a'].join('\n'))
  })

  it('rebases the indentation of the whole subtree when moving deeper', () => {
    const markdown = ['- a', '- b', '    - b1', '        - b1x'].join('\n')

    expect(moved(markdown, [0], [1])).toBe([
      '- b',
      '    - b1',
      '        - b1x',
      '    - a',
    ].join('\n'))
  })

  it('rebases tab indentation using the destination style', () => {
    const markdown = ['- a', '- b', '\t- b1'].join('\n')

    expect(moved(markdown, [0], [1])).toBe([
      '- b',
      '\t- b1',
      '\t- a',
    ].join('\n'))
  })

  it('shifts heading levels when nesting one heading under another', () => {
    const markdown = ['# Root', '## A', '### A1', '## B'].join('\n')

    expect(moved(markdown, [0, 0], [0, 1])).toBe([
      '# Root',
      '## B',
      '### A',
      '#### A1',
    ].join('\n'))
  })

  it('keeps the heading level when moving as a sibling', () => {
    const markdown = ['# Root', '## A', '### A1', '## B'].join('\n')

    expect(moved(markdown, [0, 0], [0, 1], 'after')).toBe([
      '# Root',
      '## B',
      '## A',
      '### A1',
    ].join('\n'))
  })

  it('preserves a tab/space mixed subtree relative structure', () => {
    const markdown = [
      '- root',
      '    - child',
      '\t- grandchild',
      '- other',
      '    - other-child',
    ].join('\n')

    const lines = moved(markdown, [0], [1]).split('\n')
    expect(lines).toEqual([
      '- other',
      '    - other-child',
      '    - root',
      '        - child',
      '\t\t- grandchild',
    ])
  })

  it('moves a node up to become a child of one of its ancestors', () => {
    const markdown = ['- a', '    - a1', '        - a1x', '- b'].join('\n')

    expect(moved(markdown, [0, 0, 0], [0])).toBe([
      '- a',
      '    - a1',
      '    - a1x',
      '- b',
    ].join('\n'))
  })

  it('refuses to move a node into its own descendant', () => {
    const markdown = ['- a', '    - a1', '- b'].join('\n')
    expect(moved(markdown, [0], [0, 0])).toBe(markdown)
  })

  it('is a no-op when source and target are the same node', () => {
    const markdown = ['- a', '- b'].join('\n')
    expect(moved(markdown, [0], [0])).toBe(markdown)
  })

  it('refuses to nest a heading inside a list item', () => {
    const markdown = ['# H', '- a'].join('\n')
    expect(moved(markdown, [0], [0, 0])).toBe(markdown)
  })

  it('converts a heading that cannot nest under a level-6 heading', () => {
    const markdown = ['###### deep', '## other'].join('\n')
    expect(moved(markdown, [1], [0])).toBe(['###### deep', '- other'].join('\n'))
  })

  it('reports the new source line of the moved node', () => {
    const markdown = ['- a', '- b'].join('\n')
    expect(moveNode(markdown, [0], [1]).line).toBe(1)
  })

  it('preserves paragraphs, code blocks and frontmatter', () => {
    const markdown = [
      '---',
      'tags: [x]',
      '---',
      '# Root',
      '',
      'A paragraph.',
      '',
      '```',
      '- not a node',
      '```',
      '',
      '- a',
      '- b',
    ].join('\n')

    // The paragraph is a node now and owns the code block and the list below it.
    const result = moved(markdown, [0, 0, 1], [0, 0, 2])
    expect(result).toContain('```\n- not a node\n```')
    expect(result.startsWith('---\ntags: [x]\n---')).toBe(true)
    expect(result.endsWith('- b\n  - a')).toBe(true)
  })
})

describe('moveNode conversions', () => {
  it('converts a heading to a list item when nested under a list item', () => {
    const markdown = [
      '## 三、推理模式',
      '### 子',
      '## 四、实验结果',
      '### 其他基准',
      '- a',
      '- 目标',
    ].join('\n')

    const result = moveNode(markdown, [0], [1, 0, 1], 'child')
    expect(result.line).toBeGreaterThanOrEqual(0)
    expect(result.markdown).toBe([
      '## 四、实验结果',
      '### 其他基准',
      '- a',
      '- 目标',
      '  - 三、推理模式',
      '    - 子',
    ].join('\n'))
  })

  it('keeps the list markers and checkboxes of the converted subtree', () => {
    const markdown = [
      '## H',
      '- [x] done',
      '  1. one',
      '## T',
      '- target',
    ].join('\n')

    const result = moveNode(markdown, [0], [1, 0], 'child')
    expect(result.markdown).toBe([
      '## T',
      '- target',
      '  - H',
      '    - [x] done',
      '      1. one',
    ].join('\n'))
  })

  it('re-indents a table that lives inside the converted heading', () => {
    const markdown = [
      '## H',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '## T',
      '- target',
    ].join('\n')

    const result = moveNode(markdown, [0], [1, 0], 'child')
    expect(result.markdown).toBe([
      '## T',
      '- target',
      '  - H',
      '',
      '    | a | b |',
      '    |---|---|',
      '    | 1 | 2 |',
    ].join('\n'))
  })

  it('converts a heading when the target heading cannot nest it deeper', () => {
    const markdown = [
      '###### Deep',
      '## H',
      '### C',
    ].join('\n')

    const result = moveNode(markdown, [1], [0], 'child')
    expect(result.markdown).toBe([
      '###### Deep',
      '- H',
      '  - C',
    ].join('\n'))
  })

  it('converts a heading when moved beside a list item', () => {
    const markdown = [
      '- a',
      '- b',
      '## H',
    ].join('\n')

    const result = moveNode(markdown, [2], [1], 'after')
    expect(result.markdown).toBe([
      '- a',
      '- b',
      '- H',
    ].join('\n'))
  })

  it('still moves a list item under a heading as a list', () => {
    const markdown = [
      '## H',
      '- a',
      '## T',
    ].join('\n')

    const result = moveNode(markdown, [0, 0], [1], 'child')
    expect(result.markdown).toBe([
      '## H',
      '## T',
      '- a',
    ].join('\n'))
  })
})

describe('moveNodes', () => {
  const moved = (markdown: string, sources: number[][], target: number[], position?: 'before' | 'after' | 'child') =>
    moveNodes(markdown, sources, target, position).markdown

  it('returns the document untouched for an empty selection', () => {
    const markdown = ['- a', '- b'].join('\n')
    expect(moveNodes(markdown, [], [1])).toEqual({ markdown, line: -1 })
  })

  it('matches moveNode for a single source', () => {
    const markdown = ['- a', '- b', '- c'].join('\n')
    expect(moved(markdown, [[0]], [1])).toBe(moveNode(markdown, [0], [1]).markdown)
  })

  it('moves several siblings into a target, preserving their order', () => {
    const markdown = [
      '## part-001',
      '1. one',
      '2. two',
      '3. three',
      '',
      '## block2',
    ].join('\n')

    expect(moved(markdown, [[0, 0], [0, 2]], [1])).toBe([
      '## part-001',
      '1. two',
      '',
      '## block2',
      '1. one',
      '2. three',
    ].join('\n'))
  })

  it('collapses a selection that holds a node and its descendant', () => {
    const markdown = ['- a', '    - a1', '- b', '    - b1'].join('\n')

    expect(moved(markdown, [[0], [0, 0]], [1])).toBe([
      '- b',
      '    - b1',
      '    - a',
      '        - a1',
    ].join('\n'))
  })

  it('rebases every moved subtree against the target', () => {
    const markdown = ['- a', '- b', '- c'].join('\n')
    expect(moved(markdown, [[0], [1]], [2])).toBe([
      '- c',
      '  - a',
      '  - b',
    ].join('\n'))
  })

  it('renumbers the source and destination lists', () => {
    const markdown = [
      '## A',
      '1. a1',
      '2. a2',
      '3. a3',
      '',
      '## B',
      '1. b1',
    ].join('\n')

    expect(moved(markdown, [[0, 0], [0, 2]], [1])).toBe([
      '## A',
      '1. a2',
      '',
      '## B',
      '1. b1',
      '2. a1',
      '3. a3',
    ].join('\n'))
  })

  it('supports a sibling position', () => {
    const markdown = ['- a', '- b', '- c', '- d'].join('\n')
    expect(moved(markdown, [[0], [1]], [3], 'after')).toBe([
      '- c',
      '- d',
      '- a',
      '- b',
    ].join('\n'))
  })

  it('refuses when the target is inside the selection', () => {
    const markdown = ['- a', '    - a1', '- b'].join('\n')
    expect(moved(markdown, [[0]], [0, 0])).toBe(markdown)
  })

  it('refuses when the target is one of the selected nodes', () => {
    const markdown = ['- a', '- b'].join('\n')
    expect(moved(markdown, [[0], [1]], [0])).toBe(markdown)
  })

  it('reports the line of the first inserted node', () => {
    const markdown = ['- a', '- b', '- c'].join('\n')
    expect(moveNodes(markdown, [[0], [1]], [2]).line).toBe(1)
  })
})

describe('cut and paste', () => {
  it('cut then paste matches moveNode', () => {
    const markdown = [
      '## part-001',
      '1. one',
      '2. two',
      '    1. two-a',
      '3. three',
      '',
      '## block2',
    ].join('\n')

    const block = extractSubtree(markdown, [0, 1])!
    const cut = removeSubtree(markdown, [0, 1])
    const pasted = insertSubtree(cut, [1], 'child', block)

    expect(pasted.markdown).toBe(moveNode(markdown, [0, 1], [1]).markdown)
  })

  it('extracts the raw subtree lines and parsed root', () => {
    const markdown = ['- a', '    - a1', '- b'].join('\n')
    const block = extractSubtree(markdown, [0])

    expect(block?.lines).toEqual(['- a', '    - a1'])
    expect(block?.root.text).toBe('a')
  })

  it('returns null for a missing path', () => {
    expect(extractSubtree('- a', [5])).toBeNull()
  })

  it('renumbers the list a node was cut from', () => {
    const markdown = ['1. a', '2. b', '3. c'].join('\n')
    expect(removeSubtree(markdown, [1])).toBe(['1. a', '2. c'].join('\n'))
  })

  it('rebases a cut subtree when pasted under a deeper node', () => {
    const markdown = ['- a', '- b', '    - b1'].join('\n')
    const block = extractSubtree(markdown, [0])!
    const cut = removeSubtree(markdown, [0])

    expect(insertSubtree(cut, [0], 'child', block).markdown).toBe([
      '- b',
      '    - b1',
      '    - a',
    ].join('\n'))
  })

  it('refuses an unsupported insertion and leaves the document untouched', () => {
    const markdown = '# H\n- a'
    const block = extractSubtree(markdown, [0])!
    const cut = removeSubtree(markdown, [0])
    const result = insertSubtree(cut, [0], 'child', block)

    expect(result.line).toBe(-1)
    expect(result.markdown).toBe(cut)
  })
})

describe('pathKey', () => {
  it('is equal for the same path and different for other paths', () => {
    expect(pathKey([1, 2])).toBe(pathKey([1, 2]))
    expect(pathKey([1, 2])).not.toBe(pathKey([1, 20]))
    expect(pathKey([1, 2])).not.toBe(pathKey([12]))
    expect(pathKey([])).not.toBe(pathKey([1]))
  })

  it('agrees with samePath', () => {
    const paths = [[], [0], [0, 0], [0, 1], [1], [0, 0, 0], [1, 0]]
    for (const a of paths)
      for (const b of paths)
        expect(pathKey(a) === pathKey(b)).toBe(samePath(a, b))
  })

  it('is usable as a Set key', () => {
    const keys = new Set([[0, 1], [0, 10], [0, 1]].map(pathKey))
    expect(keys.size).toBe(2)
  })
})
