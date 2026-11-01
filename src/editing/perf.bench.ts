// @vitest-environment jsdom
import { bench, describe } from 'vitest'

import { createPerfHarness, largeDocument, type PerfHarness } from 'src/test-utils/perf-harness'
import { applyEdit, parseSource } from './source-tree'

/**
 * Load test for the add-child / add-sibling path, run with `npm run bench`.
 *
 * The regression guards live in `node-editor-perf.test.ts`, which runs with the
 * suite; this file reports numbers, so it is not part of `npm test`. It covers
 * the same sizes as the guards plus much larger ones: a mindmap nobody would
 * open in Obsidian still has to stay proportional when a node is added, because
 * the editor is one mis-step away from walking every node per keystroke.
 */

/** `n` is the number of top-level list items; the document has `4n + 1` nodes. */
const DOCUMENT_SIZES = [250, 1000, 4000]

describe('parseSource', () => {
  for (const size of DOCUMENT_SIZES) {
    const markdown = largeDocument(size)
    bench(`${size * 4 + 1} nodes`, () => {
      parseSource(markdown)
    })
  }
})

describe('applyEdit', () => {
  for (const size of DOCUMENT_SIZES) {
    const markdown = largeDocument(size)
    const path = [0, Math.floor(size / 2), 1]
    const nodes = size * 4 + 1

    bench(`add child of a list item, ${nodes} nodes`, () => {
      applyEdit(markdown, { type: 'addChild', path, text: 'New node' })
    })
    bench(`add sibling of a list item, ${nodes} nodes`, () => {
      applyEdit(markdown, { type: 'addSibling', path, text: 'New node' })
    })
    bench(`add child of the root, ${nodes} nodes`, () => {
      applyEdit(markdown, { type: 'addChild', path: [], text: 'New node' })
    })
  }

  // The ordered-list path renumbers the list, which means a second pass over the
  // document: worth watching, since it is the only case that pays for it.
  const ordered = Array.from({ length: 500 }, (_, index) => `${index + 1}. item ${index}`).join('\n') + '\n'
  bench('add sibling in an ordered list, 500 nodes', () => {
    applyEdit(ordered, { type: 'addSibling', path: [499], text: 'New node' })
  })
})

describe('adding a node to a rendered mindmap', () => {
  // A jsdom render of 2001 nodes: the DOM half of the cost. Each iteration
  // leaves one inline editor behind, which is what the real editor does too.
  let harness: PerfHarness | null = null
  const rendered = (): PerfHarness => (harness ??= createPerfHarness(largeDocument(500)))

  bench('click a node, then Tab', () => {
    const h = rendered()
    h.select(h.middlePath())
    h.press('Tab')
  }, { time: 1000 })

  bench('click a node, then Enter', () => {
    const h = rendered()
    h.select(h.middlePath())
    h.press('Enter')
  }, { time: 1000 })

  bench('selecting a node (highlight)', () => {
    const h = rendered()
    h.select(h.middlePath())
  })

  // The editor re-measures the node on every animation frame while markmap
  // animates it into place, so this is the cost that multiplies: it is measured
  // on the editor opened by the first iteration, not on a fresh one each time.
  let editor: HTMLTextAreaElement | null = null
  bench('a keystroke in the inline editor (one tracked frame)', () => {
    const h = rendered()
    if (!editor) {
      h.select(h.middlePath())
      h.press('Tab')
      editor = h.input()
    }
    editor!.dispatchEvent(new Event('input'))
  }, { time: 1000 })
})
