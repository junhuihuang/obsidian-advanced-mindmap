import type { IPureNode } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import { describe, expect, it } from 'vitest'

import { addTitleToRootNode } from 'src/rendering/root-title'
import { getSourcePath, normalizeContent, tagSourcePaths } from './source-paths'
import { applyEdit, getNodeAtPath, parseSource, pathKey, removeNodes, rootChildTarget } from './source-tree'


const transformer = new Transformer()

function walkPreOrder(node: IPureNode, visit: (node: IPureNode) => void): void {
  visit(node)
  node.children.forEach(child => walkPreOrder(child, visit))
}

function startLine(node: IPureNode): number {
  return Number.parseInt(String(node.payload?.lines).split(',')[0], 10)
}

describe('one source path per rendered node', () => {
  const cases: [name: string, markdown: string][] = [
    ['flat list with a frontmatter title', '---\ntitle: My note\n---\n\n- a\n  - a1\n- b\n'],
    ['headings with a frontmatter title', '---\ntitle: My note\n---\n\n# A\n## A1\n# B\n'],
    ['prose, image and list with a frontmatter title', '---\ntitle: My note\n---\n\nIntro.\n\n![](a.png)\n\n- item\n'],
  ]

  for (const [name, markdown] of cases) {
    it(`tags every rendered node at most once (${name})`, () => {
      const { root } = transformer.transform(markdown)
      tagSourcePaths(root, parseSource(markdown))

      // Two nodes sharing a path make the editor resolve it to whichever comes
      // last in the DOM, so selecting one highlighted the other. Every node that
      // has a path must therefore be the only one with it.
      const seen = new Set<string>()
      walkPreOrder(root, node => {
        const path = getSourcePath(node)
        if (!path) return

        const key = pathKey(path)
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      })
    })
  }
})

describe('tagSourcePaths integration with markmap-lib', () => {
  const cases: [name: string, markdown: string][] = [
    ['headings', '# Root\n## A\n### A1\n## B'],
    ['nested lists', '- a\n  - a1\n- b'],
    ['heading with lists and subheading', '# Root\n- a\n  - a1\n## B'],
    ['multiple roots', '# A\n# B'],
    ['single top level list', '- a\n  - a1'],
    ['ignored paragraph', '# Root\nsome paragraph\n- a'],
    ['formatted text', '# **Root**\n- `code`\n- [link](url)'],
    ['highlight', '- ==important==\n- plain'],
    ['trailing asterisk', '- normal\n- 支持训练任务线上化*'],
    ['entities', '- 完成 AI Infra 建设\n- 关键流程可用率 ≥ 99%'],
    ['code block', '# Root\n\n```\nconst x = 1\n```\n'],
    ['table', '# Root\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'],
  ]

  for (const [name, markdown] of cases) {
    it(`maps every rendered node to its exact source line (${name})`, () => {
      const { root } = transformer.transform(markdown)
      const roots = parseSource(markdown)
      tagSourcePaths(root, roots)

      let tagged = 0
      walkPreOrder(root, node => {
        const path = getSourcePath(node)
        // The synthetic root uses the empty path: it has no source line.
        if (!path || path.length === 0) return

        tagged += 1
        const source = getNodeAtPath(roots, path)
        expect(source.line).toBe(startLine(node))
      })

      expect(tagged).toBeGreaterThan(0)
    })
  }

  it('tags a code block so it can be selected and deleted', () => {
    const markdown = '# Root\n\n```\nconst x = 1\n```\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const code = root.children[0]
    expect(normalizeContent(code.content)).toBe('const x = 1')
    expect(getSourcePath(code)).toEqual([0, 0])

    const after = removeNodes(markdown, [[0, 0]])
    expect(after.replace(/\n+$/, '')).toBe('# Root')
  })

  it('tags a table so it can be selected', () => {
    const markdown = '# Root\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    expect(getSourcePath(root.children[0])).toEqual([0, 0])
  })

  it('maps a heading that follows a list to the right source line', () => {
    const markdown = '# Root\n- a\n## B'
    const { root } = transformer.transform(markdown)
    const roots = parseSource(markdown)
    tagSourcePaths(root, roots)

    const b = root.children.find(child => normalizeContent(child.content) === 'B')!
    expect(getSourcePath(b)).toEqual([0, 1])
  })

  it('leaves a list-wrapper root untagged instead of giving it its first item path', () => {
    // markmap promotes a document's top-level `ul` to the root and fills its
    // empty content with the frontmatter `title:`. Its `data-lines` start on the
    // first item's line, so tagging it by line would make the visible root and
    // that item share a path: selecting the title highlighted the item.
    const markdown = '---\ntitle: My note\n---\n\n- a\n  - a1\n- b\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    expect(normalizeContent(root.content)).toBe('My note')
    expect(getSourcePath(root)).toEqual([])
    expect(getSourcePath(root.children[0])).toEqual([0])
    expect(getSourcePath(root.children[1])).toEqual([1])
  })

  it('leaves a prose paragraph container untagged instead of giving it its first child path', () => {
    // A paragraph followed by a list is rendered as an empty container whose
    // `data-lines` starts on the first list item's line. In the DOM that
    // container comes after its children (markmap renders post-order), so a
    // shared path would resolve to the invisible container and make the first
    // item unselectable and uneditable.
    const markdown = '下午临时参加了汇报。\n- 第一项\n- 第二项\n\n回忆方法论？\n1. [[金字塔思维]]\n2. [[第一性原理]]\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const [bullets, numbers] = root.children
    expect(normalizeContent(bullets.content)).toBe('')
    expect(getSourcePath(bullets)).toBeUndefined()
    expect(getSourcePath(bullets.children[0])).toEqual([0, 0])
    expect(getSourcePath(bullets.children[1])).toEqual([0, 1])

    expect(normalizeContent(numbers.content)).toBe('')
    expect(getSourcePath(numbers)).toBeUndefined()
    expect(getSourcePath(numbers.children[0])).toEqual([1, 0])
    expect(getSourcePath(numbers.children[1])).toEqual([1, 1])
  })

  it('gives every rendered node a unique source path when paragraphs group lists', () => {
    const markdown = 'prose\n- first\n- second\n\nmore prose\n1. [[one]]\n2. two\n'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const counts = new Map<string, number>()
    walkPreOrder(root, node => {
      const path = getSourcePath(node)
      if (!path) return
      counts.set(pathKey(path), (counts.get(pathKey(path)) ?? 0) + 1)
    })

    expect([...counts.values()].filter(count => count > 1)).toEqual([])
  })

  it('tags a synthetic root with the empty path', () => {
    const markdown = '- a\n  - a1\n- b'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    expect(getSourcePath(root)).toEqual([])
    expect(getSourcePath(root.children[0])).toEqual([0])
    expect(getSourcePath(root.children[1])).toEqual([1])
  })

  it('keeps the real path on a single-node root', () => {
    const markdown = '# Root\n## A'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    expect(getSourcePath(root)).toEqual([0])
  })

  it('tags an empty list item so it can be selected and deleted', () => {
    const markdown = '- a\n  - b\n  - \n- c'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const empty = root.children[0].children[1]
    expect(normalizeContent(empty.content)).toBe('')
    expect(getSourcePath(empty)).toEqual([0, 1])
    expect(getSourcePath(root)).toEqual([])
  })

  it('tags an empty ordered item that markmap renders as `3. `', () => {
    const markdown = '1. parent\n    1. a\n    2. b\n    3. \n2. after'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const empty = root.children[0].children[2]
    expect(getSourcePath(empty)).toEqual([0, 2])
  })

  it('can delete an empty item once it has a path', () => {
    const markdown = '1. parent\n    1. a\n    2. b\n    3. \n2. after'
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))

    const emptyPath = getSourcePath(root.children[0].children[2])!
    const after = removeNodes(markdown, [emptyPath])
    const { root: next } = transformer.transform(after)

    expect(normalizeContent(next.children[0].content)).toBe('parent')
    expect(next.children[0].children.map(child => normalizeContent(child.content))).toEqual(['a', 'b'])
  })
})

describe('addChild produces a real child in markmap', () => {
  const cases: [name: string, before: string][] = [
    ['ordered list', '1. one'],
    ['bullet list', '- one'],
    ['tab indented ordered list', '1. a\n\t1. b'],
    ['wide ordered marker', '10. ten'],
  ]

  for (const [name, before] of cases) {
    it(name, () => {
      const after = applyEdit(before, { type: 'addChild', path: [0], text: 'child' })
      const { root } = transformer.transform(after)

      const childContents = root.children.map(child => normalizeContent(child.content))
      expect(childContents).toContain('child')
    })
  }

  it('addSibling adds a sibling rather than a child', () => {
    const after = applyEdit('1. one', { type: 'addSibling', path: [0], text: 'two' })
    const { root } = transformer.transform(after)

    expect(root.children.map(child => normalizeContent(child.content))).toEqual(['one', 'two'])
  })
})

describe('adding below the synthetic root', () => {
  /**
   * Replays what the pinned-mindmap renderer does after a write: transform the
   * markdown, tag every node with its source path, then give the root the file
   * name (`renderer-tab.ts`). The order matters: tagging runs first, so a
   * synthetic root always keeps the empty path and the title wrapper added
   * afterwards can never steal a document node's path.
   */
  function render(markdown: string, title = '对外界面') {
    const { root } = transformer.transform(markdown)
    tagSourcePaths(root, parseSource(markdown))
    return addTitleToRootNode(root, title)
  }

  function findByPath(root: IPureNode, path: number[]): IPureNode | undefined {
    let found: IPureNode | undefined
    walkPreOrder(root, node => {
      if (getSourcePath(node)?.join('.') === path.join('.')) found = node
    })
    return found
  }

  const cases: [name: string, markdown: string][] = [
    ['prose only', '> 从外部视角审视自己的工作\n'],
    ['empty file', ''],
    ['flat list', '- a\n- b\n'],
    ['several headings', '# A\n# B\n'],
  ]

  for (const [name, markdown] of cases) {
    it(`adds a node to the root of a document with no single top-level node (${name})`, () => {
      // The root of such a document is synthetic: it has no source line.
      expect(getSourcePath(render(markdown))).toEqual([])

      const roots = parseSource(markdown)
      // Mirror `addNode`: the new node is appended as the last top-level node.
      const target = rootChildTarget(markdown)
      expect(target.path).toEqual([roots.length])
      const after = applyEdit(markdown, { type: 'addChild', path: [], text: 'New node' })

      // The written markdown is addressable by the path the editor selected.
      expect(getNodeAtPath(parseSource(after), target.path).text).toBe('New node')

      // …and markmap renders it on the expected source line, so the inline
      // editor opens on it (it is located by line).
      const node = findByPath(render(after), target.path)
      expect(node).toBeDefined()
      expect(normalizeContent(node!.content)).toBe('New node')
      expect(startLine(node!)).toBe(target.line)
    })
  }

  it('keeps the existing nodes of a flat list intact', () => {
    const markdown = '- a\n  - a1\n- b\n'
    const after = applyEdit(markdown, { type: 'addChild', path: [], text: 'c' })
    const root = render(after)

    expect(root.children.map(node => normalizeContent(node.content))).toEqual(['a', 'b', 'c'])
    expect(root.children[0].children.map(node => normalizeContent(node.content))).toEqual(['a1'])
  })

  it('keeps the title root in place when a node-less document gets its first node', () => {
    // markmap makes a single top-level node the root, so the title is wrapped
    // around the document instead (see `root-title.ts`): the note is never
    // modified to show its name, and the root never changes.
    const title = '对外界面'
    const markdown = '> 从外部视角审视自己的工作\n'
    const target = rootChildTarget(markdown)

    const first = applyEdit(markdown, { type: 'addChild', path: [], text: 'a' })
    expect(first).toBe('> 从外部视角审视自己的工作\n- a\n')

    // The root the user sees is the title, and the new node hangs below it.
    const root = render(first)
    expect(normalizeContent(root.content)).toBe(title)
    expect(getSourcePath(root)).toEqual([])
    expect(root.children.map(child => normalizeContent(child.content))).toEqual(['a'])
    expect(getSourcePath(root.children[0])).toEqual(target.path)
    expect(startLine(findByPath(root, target.path)!)).toBe(target.line)

    // …and it stays put when a sibling is added (which is what `Enter` does).
    const second = applyEdit(first, { type: 'addSibling', path: [0], text: 'b' })
    const next = render(second)
    expect(normalizeContent(next.content)).toBe(title)
    expect(next.children.map(child => normalizeContent(child.content))).toEqual(['a', 'b'])
  })

  it('keeps the title root in place for a note with a single heading', () => {
    const markdown = '# 我的笔记\n- a\n'
    const root = render(markdown)

    // The note's own heading is a child of the title, not the root itself.
    expect(normalizeContent(root.content)).toBe('对外界面')
    expect(getSourcePath(root)).toEqual([])
    expect(normalizeContent(root.children[0].content)).toBe('我的笔记')
    expect(getSourcePath(root.children[0])).toEqual([0])
    expect(getSourcePath(root.children[0].children[0])).toEqual([0, 0])
  })

  it('keeps working when the new node becomes the document root', () => {
    // markmap makes a single top-level node the markdown root; the title is
    // wrapped above it, so the second `Tab` must still find the node it was
    // given, one level down.
    const first = applyEdit('> 从外部视角审视自己的工作\n', { type: 'addChild', path: [], text: 'New node' })
    expect(first).toBe('> 从外部视角审视自己的工作\n- New node\n')

    const title = render(first)
    const documentRoot = title.children[0]
    expect(getSourcePath(title)).toEqual([])
    expect(getSourcePath(documentRoot)).toEqual([0])
    expect(normalizeContent(documentRoot.content)).toBe('New node')

    // Second node: a child of the first (`applyEdit` uses its real path now).
    const second = applyEdit(first, { type: 'addChild', path: [0], text: 'Child' })
    const next = render(second)
    const node = next.children[0]
    expect(normalizeContent(node.content)).toBe('New node')
    expect(node.children.map(child => normalizeContent(child.content))).toEqual(['Child'])
    expect(getSourcePath(node.children[0])).toEqual([0, 0])
  })

  it('keeps ordered list numbers aligned with the display', () => {
    const after = applyEdit('1. a\n2. b\n', { type: 'addChild', path: [], text: 'c' })
    const root = render(after)

    expect(root.children.map(node => node.payload?.listIndex)).toEqual([1, 2, 3])
  })
})

describe('ordered list numbering matches the markmap display', () => {
  function expectNumbersToMatch(markdown: string) {
    const { root } = transformer.transform(markdown)
    const roots = parseSource(markdown)
    tagSourcePaths(root, roots)

    let checked = 0
    walkPreOrder(root, node => {
      const listIndex = node.payload?.listIndex
      if (typeof listIndex !== 'number') return

      const path = getSourcePath(node)
      expect(path).toBeDefined()

      const source = getNodeAtPath(roots, path!)
      expect(Number.parseInt(source.marker, 10)).toBe(listIndex)
      checked += 1
    })

    expect(checked).toBeGreaterThan(0)
  }

  it('after adding a child', () => {
    const after = applyEdit('1. a\n    1. b', { type: 'addChild', path: [0], text: 'c' })
    expectNumbersToMatch(after)
  })

  it('after adding a sibling in the middle', () => {
    const after = applyEdit('1. a\n2. b\n3. c', { type: 'addSibling', path: [1], text: 'new' })
    expectNumbersToMatch(after)
  })

  it('after removing an item', () => {
    const after = applyEdit('1. a\n2. b\n3. c', { type: 'remove', path: [0] })
    expectNumbersToMatch(after)
  })

  it('after adding a sibling at the top level', () => {
    const after = applyEdit('1. a\n2. b', { type: 'addSibling', path: [0], text: 'new' })
    expectNumbersToMatch(after)
  })
})

describe('deleting an item keeps the list nested', () => {
  it('keeps a sub-list nested after deleting its first item', () => {
    const before = '4. parent\n    1. a\n    2. b\n    3. c'
    const after = applyEdit(before, { type: 'remove', path: [0, 0] })
    const { root } = transformer.transform(after)

    expect(normalizeContent(root.content)).toBe('parent')
    expect(root.children.map(child => normalizeContent(child.content))).toEqual(['b', 'c'])
  })

  it('keeps a sub-list nested after deleting the first item of a bullet parent', () => {
    const before = '- parent\n    1. a\n    2. b'
    const after = applyEdit(before, { type: 'remove', path: [0, 0] })
    const { root } = transformer.transform(after)

    expect(normalizeContent(root.content)).toBe('parent')
    expect(root.children.map(child => normalizeContent(child.content))).toEqual(['b'])
  })
})
