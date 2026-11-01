// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setData: vi.fn(), fit: vi.fn(), rescale: vi.fn(), destroy: vi.fn(), renderData: vi.fn(),
  context: null as any,
  state: {} as any,
  editor: { focus: vi.fn(), destroy: vi.fn() },
  transform: vi.fn(() => ({ content: '', children: [] })),
  cachedRead: vi.fn(), modify: vi.fn(), settings: { animationDuration: 0 },
  svgs: new Map(),
  createLeafBySplit: vi.fn(),
  workspaceOn: vi.fn(() => ({})),
  workspaceOffref: vi.fn(),
}))
vi.mock('src/core/app', () => ({ getApp: () => (globalThis as any).app }))
vi.mock('src/settings/filesystem', () => ({ globalSettings: mocks.settings, nodeWidthsFor: () => ({}), saveNodeWidth: () => false }))
vi.mock('src/rendering/screenshot', () => ({ takeScreenshot: vi.fn() }))
vi.mock('./renderer-common', () => ({
  createMarkmap: ({ parent }: any) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    parent.append(svg)
    return {
      svg,
      markmap: { setData: mocks.setData, renderData: mocks.renderData, svg: { node: () => svg }, options: { color: () => '' }, fit: mocks.fit, rescale: mocks.rescale, destroy: mocks.destroy, state: mocks.state },
    }
  },
  getOptions: () => ({ duration: 0 }), transformMarkdown: mocks.transform,
  splitMarkdown: () => ({ settings: {} }),
}))
vi.mock('./editor-wiring', () => ({ createMindmapEditor: (_mm: any, context: any) => { mocks.context = context; return mocks.editor } }))
vi.mock('src/internal-links/handle-internal-links', () => ({ svgs: mocks.svgs }))
vi.mock('./node-circles', () => ({ removeChildlessCircles: vi.fn() }))

import { TabRenderer } from './renderer-tab'

const a = { path: 'a.md', basename: 'a' } as any
const ownerLeaf = { view: { containerEl: document.createElement('div') } } as any

function renderer() {
  const container = document.createElement('div')
  container.append(document.createElement('div'), document.createElement('div'))
  document.body.append(container)
  document.body.append(ownerLeaf.view.containerEl)
  return TabRenderer(container, ownerLeaf)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.svgs.clear()
  delete mocks.state.data
  mocks.setData.mockImplementation(async (root: any) => {
    mocks.state.data = { ...root, state: { id: 1, key: 'root', path: '1', depth: 1 }, children: [] }
  })
  mocks.renderData.mockResolvedValue(undefined)
  mocks.cachedRead.mockResolvedValue('- a')
  mocks.modify.mockResolvedValue(undefined)
  vi.stubGlobal('app', {
    vault: { cachedRead: mocks.cachedRead, modify: mocks.modify },
    workspace: {
      createLeafBySplit: mocks.createLeafBySplit,
      on: mocks.workspaceOn,
      offref: mocks.workspaceOffref,
    },
  })
})

describe('TabRenderer lifecycle and render workload', () => {
  it('ignores a stale in-flight disk read when a local insertion has already advanced the source', async () => {
    const r = renderer()
    await r.firstRender(a)
    let resolve!: (text: string) => void
    mocks.cachedRead.mockImplementation(() => new Promise<string>(done => { resolve = done }))
    const reading = r.render(a)
    await Promise.resolve()
    mocks.cachedRead.mockClear()
    const next = '- a\n- new'
    mocks.context.onSourceChange('- a', next, [{ type: 'insert', path: [1] }])
    const writing = mocks.context.setMarkdown(next)
    resolve('- a')
    await Promise.all([reading, writing])
    expect(mocks.context.getMarkdown()).toBe(next)
    expect(mocks.renderData).toHaveBeenCalledOnce()
    mocks.context.onSourceChange(next, `${next}\n  - child`, [{ type: 'insert', path: [1, 0] }])
    await mocks.context.setMarkdown(`${next}\n  - child`)
    expect(mocks.setData).toHaveBeenCalledOnce()
    r.destroy()
  })

  it('uses local content for layout notifications while a disk save is pending', async () => {
    const r = renderer()
    await r.firstRender(a)
    let save!: () => void
    mocks.modify.mockImplementation(() => new Promise<void>(done => { save = done }))
    const next = '- a\n- new'
    mocks.context.onSourceChange('- a', next, [{ type: 'insert', path: [1] }])
    const writing = mocks.context.setMarkdown(next)
    await vi.waitFor(() => expect(mocks.renderData).toHaveBeenCalledOnce())
    mocks.cachedRead.mockClear()
    await r.render(a)
    expect(mocks.cachedRead).not.toHaveBeenCalled()
    expect(mocks.context.getMarkdown()).toBe(next)
    expect(mocks.setData).toHaveBeenCalledOnce()
    save()
    await writing
    r.destroy()
  })

  it('skips the disk-save echo without parsing or resetting folds', async () => {
    const r = renderer()
    await r.firstRender(a)
    mocks.transform.mockClear()
    await r.render(a, '- a')
    expect(mocks.transform).not.toHaveBeenCalled()
    expect(mocks.setData).toHaveBeenCalledOnce()
    r.destroy()
  })

  it('coalesces a burst of requested renders and renders only the latest markdown', async () => {
    const r = renderer()
    await r.firstRender(a)
    mocks.transform.mockClear()
    await Promise.all([r.render(a, '- one'), r.render(a, '- two'), r.render(a, '- latest')])
    expect(mocks.transform.mock.calls).toEqual([['- latest', expect.any(Array)]])
  })

  it('drives the markmap from the header zoom and fit actions', () => {
    const r = renderer()
    r.zoomIn()
    r.zoomOut()
    r.fit()
    expect(mocks.rescale.mock.calls).toEqual([[1.25], [0.8]])
    expect(mocks.fit).toHaveBeenCalledOnce()
  })

  it('opens the note in a native markdown split and reports the state to the view', async () => {
    const r = renderer()
    await r.firstRender(a)
    const states: boolean[] = []
    r.onMarkdownSourceChange(open => states.push(open))

    const leaf = { view: { containerEl: document.createElement('div') }, openFile: vi.fn(), detach: vi.fn() }
    document.body.append(leaf.view.containerEl)
    mocks.createLeafBySplit.mockReturnValue(leaf)

    r.toggleMarkdownSource()
    await vi.waitFor(() => expect(leaf.openFile).toHaveBeenCalledWith(a, { active: true }))
    expect(mocks.createLeafBySplit).toHaveBeenCalledOnce()
    expect(states).toEqual([true])
  })

  it('releases the editor, markmap and svg registry when destroyed', async () => {
    const r = renderer()
    await r.firstRender(a)
    expect(mocks.svgs.size).toBe(1)
    r.destroy()
    r.destroy()
    expect(mocks.editor.destroy).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.svgs.size).toBe(0)
    mocks.transform.mockClear()
    await r.render(a, '- closed')
    expect(mocks.transform).not.toHaveBeenCalled()
  })

  it('does not start a setData after a closed view finishes an outstanding file read', async () => {
    let resolve!: (text: string) => void
    mocks.cachedRead.mockImplementation(() => new Promise<string>(done => { resolve = done }))
    const r = renderer()
    const pending = r.firstRender(a)
    await Promise.resolve()
    r.destroy()
    resolve('- late')
    await pending
    expect(mocks.setData).not.toHaveBeenCalled()
    expect(mocks.fit).not.toHaveBeenCalled()
  })
})
