import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NodeEditorOptions } from 'src/editing/node-editor'


// The wiring is a thin adapter over `renderer-common` and `node-editor`, so both
// are stubbed: this test only checks that each callback lands on the right
// markmap/helper. Importing the real `renderer-common` pulls in markmap's
// browser-only setup, which does not load under jsdom.
const helpers = vi.hoisted(() => ({
  applyFoldPlan: vi.fn(),
  centerSubtree: vi.fn(),
  contentZoomAnchor: vi.fn(),
  unfoldAllLevels: vi.fn(),
  unfoldOneLevel: vi.fn(),
  zoomAnchor: vi.fn(),
  zoomMarkmap: vi.fn(),
  zoomRect: vi.fn(),
}))

const attachNodeEditor = vi.hoisted(() => vi.fn())

vi.mock('./renderer-common', () => helpers)
vi.mock('src/editing/node-editor', () => ({ attachNodeEditor }))

import { createMindmapEditor } from './editor-wiring'


/** A markmap stand-in exposing just what the wiring touches. */
function fakeMarkmap() {
  return {
    state: { data: { content: 'root' } },
    ensureVisible: vi.fn(),
    toggleNode: vi.fn(() => Promise.resolve()),
    handleClick: vi.fn(),
  }
}

type FakeMarkmap = ReturnType<typeof fakeMarkmap>

const options = {
  svg: {} as SVGSVGElement,
  getMarkdown: () => '- a',
  setMarkdown: () => undefined,
  getNodeWidths: () => ({}),
  setNodeWidth: () => false,
  getAnimationDuration: () => 500,
}

function wire(markmap: FakeMarkmap = fakeMarkmap()) {
  const handle = { destroy: vi.fn(), focus: vi.fn() }
  attachNodeEditor.mockReturnValue(handle)
  const result = createMindmapEditor(markmap as never, options)
  const passed = attachNodeEditor.mock.calls[0][0] as NodeEditorOptions
  return { markmap, result, handle, passed }
}

beforeEach(() => {
  attachNodeEditor.mockReset()
  for (const helper of Object.values(helpers)) helper.mockReset()
})

describe('createMindmapEditor', () => {
  it('hands the editor the caller-supplied source accessors', () => {
    const { passed } = wire()

    expect(passed.svg).toBe(options.svg)
    expect(passed.getMarkdown()).toBe('- a')
    expect(passed.getAnimationDuration?.()).toBe(500)
  })

  it('returns the handle produced by the editor', () => {
    const { result, handle } = wire()

    expect(result).toBe(handle)
  })

  it('drives folding and the whole-tree commands through the markmap', () => {
    const { markmap, passed } = wire()
    const node = { content: 'a' }

    void passed.toggleFold?.(node as never)
    expect(markmap.toggleNode).toHaveBeenCalledWith(node)

    void passed.revealChildren?.(node as never)
    expect(helpers.unfoldOneLevel).toHaveBeenCalledWith(markmap, node)

    void passed.revealAllChildren?.(node as never)
    expect(helpers.unfoldAllLevels).toHaveBeenCalledWith(markmap, node)

    expect(passed.getFoldRoot?.()).toBe(markmap.state.data)
  })

  it('centers and zooms through the shared helpers', () => {
    const { markmap, passed } = wire()
    const node = { content: 'a' }

    void passed.centerNode?.(node as never)
    expect(helpers.centerSubtree).toHaveBeenCalledWith(markmap, node)

    passed.zoomBy?.(2, { x: 1, y: 2 }, { x: 0, y: 0, width: 1, height: 1 })
    expect(helpers.zoomMarkmap).toHaveBeenCalledWith(markmap, 2, { x: 1, y: 2 }, { x: 0, y: 0, width: 1, height: 1 })
  })

  it('installs its own circle-click handler that re-centers', () => {
    const markmap = fakeMarkmap()
    const original = markmap.handleClick

    wire(markmap)

    expect(markmap.handleClick).not.toBe(original)
    expect(markmap.handleClick).toBeTypeOf('function')
  })
})
