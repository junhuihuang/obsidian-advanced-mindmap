// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { createPerfHarness, largeDocument, timeAverage, type PerfHarness } from 'src/test-utils/perf-harness'
import { applyEdit } from './source-tree'

/**
 * Guards for the add-child / add-sibling path.
 *
 * Adding a node has to feel instant, whatever the size of the mindmap: the
 * inline editor opens before the write and the re-render finish, so everything
 * on this path is work the user waits for. The editor is attached to a *fully
 * expanded* map in these tests, which is the worst case for anything that walks
 * the DOM or the document.
 *
 * The assertions are mostly *counts* rather than timings: a count says "this
 * does not get slower as the mindmap grows", which a millisecond budget cannot
 * express and a slow machine cannot break. The two timing budgets are generous
 * (an order of magnitude above what the code does) and only catch a return to
 * scanning every node.
 */

/** A mindmap of about `4 * n` nodes. */
const SMALL = 100
const BIG = 500

let harness: PerfHarness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/**
 * Opens the inline editor on `path` (a click, then `Tab`), as the user does.
 *
 * Nothing cleans up between iterations: the editor drops the previous input
 * when the new one takes focus, exactly as it does under the real keyboard.
 */
function addChild(h: PerfHarness, path: number[]) {
  h.select(path)
  h.press('Tab')
}

/** Opens the inline editor as a sibling (a click, then `Enter`). */
function addSibling(h: PerfHarness, path: number[]) {
  h.select(path)
  h.press('Enter')
}

/** The inline editors still in the document. */
function editorCount(): number {
  return document.querySelectorAll('textarea.advmm-node-editor').length
}

/** `svg.querySelectorAll` calls made while adding a child, on average. */
function queriesPerAdd(size: number, add = addChild): number {
  const h = createPerfHarness(largeDocument(size))
  harness = h
  const path = h.middlePath()
  add(h, path)
  h.resetQueries()
  for (let i = 0; i < 10; i++) add(h, path)
  return h.queries() / 10
}

describe('adding a node', () => {
  it('does not scan the DOM, however large the mindmap is', () => {
    // Baseline was ~12 lookups per added node (every one of them a full
    // `querySelectorAll` plus a walk of every node), plus one per animation
    // frame while the editor follows the new node into place.
    const small = queriesPerAdd(SMALL)
    const big = queriesPerAdd(BIG)
    expect(big).toBeLessThanOrEqual(2)
    expect(big).toBe(small)
  })

  it('does not scan the DOM when adding a sibling either', () => {
    expect(queriesPerAdd(BIG, addSibling)).toBeLessThanOrEqual(2)
  })

  it('does not scan the DOM while the inline editor follows the new node', () => {
    // markmap animates the node into place over several hundred milliseconds
    // and the editor re-measures on every frame of that animation.
    const h = createPerfHarness(largeDocument(BIG))
    harness = h
    addChild(h, h.middlePath())
    const input = h.input()!
    h.resetQueries()
    for (let i = 0; i < 20; i++) input.dispatchEvent(new Event('input'))
    expect(h.queries()).toBeLessThanOrEqual(1)
  })

  it('stays fast as the mindmap grows', () => {
    // Measured against the same edit on a fifth of the nodes rather than
    // against a millisecond budget: an absolute budget only says how fast the
    // machine is (a loaded CI runner pushed this over 20 ms while the ratio
    // stayed at ~1.4), while the ratio is what this test is about. Adding a
    // node used to walk every one of the 2001 rendered nodes a dozen times,
    // which no amount of machine speed hides.
    const small = createPerfHarness(largeDocument(SMALL))
    const smallPath = small.middlePath()
    const smallAverage = timeAverage(() => addChild(small, smallPath), 5)
    small.destroy()

    const h = createPerfHarness(largeDocument(BIG))
    harness = h
    const path = h.middlePath()
    const average = timeAverage(() => addChild(h, path), 10)
    // The floor keeps a very fast machine from turning jitter into a failure.
    expect(average).toBeLessThan(Math.max(smallAverage * 3, 8))
    // The editor the previous iteration opened is dropped when the next one
    // takes focus, so exactly the last one is left.
    expect(editorCount()).toBe(1)
  })
})

describe('writing the new node', () => {
  /**
   * How many times the document is split into lines (and joined back) by `fn`.
   * Splitting is how the whole document is scanned, so this counts scans.
   */
  function documentScans(fn: () => void): { splits: number, joins: number } {
    const split = String.prototype.split
    const join = Array.prototype.join
    let splits = 0
    let joins = 0
    String.prototype.split = function (this: string, ...args: unknown[]) {
      if (args[0] === '\n') splits++
      return (split as (...a: unknown[]) => string[]).apply(this, args)
    } as unknown as typeof String.prototype.split
    Array.prototype.join = function (this: unknown[], ...args: unknown[]) {
      if (args[0] === '\n') joins++
      return (join as (...a: unknown[]) => string).apply(this, args)
    } as unknown as typeof Array.prototype.join
    try {
      fn()
    }
    finally {
      String.prototype.split = split
      Array.prototype.join = join
    }
    return { splits, joins }
  }

  it('scans the document once, not once per lookup', () => {
    // `applyEdit` used to parse the document (a full line scan), then re-parse
    // it a second time only to renumber ordered lists, on top of the caller's
    // own parse of the same document.
    const markdown = largeDocument(BIG)
    const operations = [
      { type: 'addChild' as const, path: [0, 0, 0], text: 'x' },
      { type: 'addSibling' as const, path: [0, 0, 0], text: 'x' },
      { type: 'addChild' as const, path: [], text: 'x' },
    ]
    for (const operation of operations) {
      expect(documentScans(() => applyEdit(markdown, operation))).toEqual({ splits: 1, joins: 1 })
    }
  })

  it('still renumbers ordered lists', () => {
    // The fast path must not skip the renumbering that ordered lists need.
    expect(applyEdit('1. a\n2. b\n', { type: 'addSibling', path: [1], text: 'c' }))
      .toBe('1. a\n2. b\n3. c\n')
    expect(applyEdit('1. a\n2. b\n', { type: 'addChild', path: [0], text: 'c' }))
      .toBe('1. a\n   1. c\n2. b\n')
    expect(applyEdit('- a\n- b\n', { type: 'addChild', path: [], text: 'c' }))
      .toBe('- a\n- b\n- c\n')
  })
})
