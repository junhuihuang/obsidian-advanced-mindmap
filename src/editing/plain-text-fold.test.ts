// @vitest-environment jsdom
import type { IPureNode } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dropEmptyWrappers, insertProseNodes } from 'src/rendering/prose-nodes'
import { revealOneLevel } from './fold'
import { attachNodeEditor } from './node-editor'
import { getSourcePath, tagSourcePaths } from './source-paths'
import { parseSource, pathKey } from './source-tree'

// Obsidian augments the DOM with these helpers; provide a minimal version.
const proto = Element.prototype as unknown as Record<string, unknown>
proto.addClass = function (this: Element, ...classes: string[]) { this.classList.add(...classes) }
proto.removeClass = function (this: Element, ...classes: string[]) { this.classList.remove(...classes) }
proto.toggleClass = function (this: Element, cls: string, on: boolean) { this.classList.toggle(cls, on) }

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

const transformer = new Transformer()
const MARKDOWN = '# T\n\nprose\n\n- one\n- two\n'

/** `transformMarkdown(markdown, roots, { prose: false })`. */
function tree(): IPureNode {
  const { root } = transformer.transform(MARKDOWN)
  const roots = parseSource(MARKDOWN)
  tagSourcePaths(root, roots)
  // The paragraph introduces the list, so it stays a node with the switch off.
  insertProseNodes(root, roots, text => transformer.md.renderInline(text), { structuralOnly: true })
  dropEmptyWrappers(root)
  return root
}

/**
 * The same tree with an empty wrapper where `insertProseNodes` puts the
 * paragraph: markmap leaves one behind for a paragraph that introduces a list,
 * and `dropEmptyWrappers` is the last step that clears such leftovers.
 */
function treeWithLeftoverWrapper(): IPureNode {
  const root = tree()
  // A single top-level heading is markmap's root, so the list hangs off it.
  root.children = [{ content: '', children: root.children, payload: {} }]
  dropEmptyWrappers(root)
  return root
}

/**
 * The case that made `l` do nothing on a section of a long note: a folded
 * heading whose first source child is a plain paragraph, so the canvas draws the
 * list one level up, inside the empty wrapper markmap built for the paragraph.
 */
describe('a folded node with plain-text nodes switched off', () => {
  afterEach(() => { document.body.innerHTML = '' })

  for (const [shape, build] of [['collapsed by markmap', tree], ['after a leftover empty wrapper', treeWithLeftoverWrapper]] as const) {
  it(`unfolds one level and selects the first node that is actually drawn (${shape})`, async () => {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const markmap = Markmap.create(svg as unknown as SVGSVGElement, { duration: 0, embedGlobalCSS: false })
    markmap.transition = (selection: unknown) => selection as never
    await markmap.setData(build())

    // A single top-level heading becomes markmap's root. Fold it: the canvas
    // shows only `T`.
    const heading = markmap.state.data as IPureNode
    heading.payload = { ...heading.payload, fold: 1 }
    await markmap.renderData()

    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => MARKDOWN,
      getSourceRoots: () => parseSource(MARKDOWN),
      setMarkdown: vi.fn(),
      getFoldRoot: () => markmap.state.data as IPureNode,
      revealChildren: async node => {
        revealOneLevel(node)
        await markmap.renderData()
      },
    })

    const selected = () => Array.from(svg.querySelectorAll('g.markmap-node.advmm-selected'))
      .map(group => {
        const path = getSourcePath((group as unknown as { __data__: IPureNode }).__data__)
        return path ? pathKey(path) : 'untagged'
      })
    const groupOf = (key: string) => Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
      .find(group => {
        const path = getSourcePath((group as unknown as { __data__: IPureNode }).__data__)
        return !!path && pathKey(path) === key
      })

    groupOf('0')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(selected()).toEqual(['0.0']))
  })
  }
})
