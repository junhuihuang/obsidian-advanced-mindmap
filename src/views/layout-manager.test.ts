import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  subjects: new Map<object, any>(),
  replace: vi.fn(),
  closeAll: vi.fn(),
  activeFile: { path: 'active.md', basename: 'active' },
}))

vi.mock('src/core/app', () => ({ getApp: () => (globalThis as any).app }))
vi.mock('obsidian', () => ({ WorkspaceSplit: class {}, WorkspaceTabs: class {}, WorkspaceLeaf: class {}, TFile: class {} }))
vi.mock('./view', () => ({ default: class MindmapView {
  firstRender = vi.fn()
  getViewType() { return 'advanced-mindmap-view' }
} }))
vi.mock('./views', () => ({ default: { get: (view: object) => mocks.subjects.get(view) } }))
vi.mock('./leaf-manager', () => ({ leafManager: { replace: mocks.replace } }))
vi.mock('./loading-view', () => ({ LoadingView: { closeAll: mocks.closeAll } }))
vi.mock('./view-creator', () => ({ constructView: vi.fn() }))
vi.mock('./get-active-file', () => ({ getActiveFile: () => mocks.activeFile }))
vi.mock('src/settings/filesystem', () => ({ layout: { save: mocks.save, load: mocks.load } }))

import MindmapView from './view'
import { layoutManager } from './layout-manager'

const a = { path: 'a.md', basename: 'a' }
const b = { path: 'b.md', basename: 'b' }
const c = { path: 'c.md', basename: 'c' }
const pinned = (file: typeof a) => ({ type: 'pinned', path: file.path })

function markdown() {
  return { view: { getViewType: () => 'markdown' } }
}
function mindmap(subject: typeof a | 'unpinned') {
  const view = new MindmapView({} as never, '', subject !== 'unpinned')
  mocks.subjects.set(view, subject)
  return { view }
}
function tabs(children: any[], currentTab = children.length - 1) {
  const group = { type: 'tabs', children, currentTab }
  children.forEach(leaf => { leaf.parent = group })
  return group
}
function split(children: any[]) { return { type: 'split', children } }
function workspace(root: any, activeTabGroup = root.children.at(-1)) {
  const ws = {
    rootSplit: root,
    activeTabGroup,
    setActiveLeaf: vi.fn((leaf: any) => {
      if (!leaf) throw new Error('Cannot activate an undefined leaf')
      leaf.parent.currentTab = leaf.parent.children.indexOf(leaf)
    }),
  }
  vi.stubGlobal('app', { workspace: ws, vault: { getMarkdownFiles: () => [a, b, c] } })
  return ws
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.subjects.clear()
  mocks.replace.mockImplementation(async (leaf: any, subject: typeof a) => {
    const replacement = mindmap(subject)
    const group = leaf.parent
    group.children.splice(group.children.indexOf(leaf), 1, replacement)
    ;(replacement as any).parent = group
  })
})

describe('mindmap workspace layout', () => {
  it('saves both siblings of rootSplit, not just the left pane', () => {
    workspace(split([tabs([markdown(), mindmap(a)]), tabs([markdown(), mindmap(b)])]))
    layoutManager.serialise()
    expect(mocks.save).toHaveBeenCalledWith({
      version: 1,
      root: [[null, pinned(a)], [null, pinned(b)]],
    })
  })

  it('saves nested splits and inactive mindmap tabs across the whole root', () => {
    workspace(split([tabs([mindmap(a), markdown()], 1), split([tabs([mindmap(b)]), tabs([mindmap('unpinned')])])]))
    layoutManager.serialise()
    expect(mocks.save).toHaveBeenCalledWith({ version: 1, root: [[pinned(a), null], [[pinned(b)], [{ type: 'unpinned' }]]] })
  })

  it('restores and renders both panes, preserving their tabs and the active right pane', async () => {
    const left = tabs([markdown(), markdown()])
    const right = tabs([markdown(), markdown()])
    const leftSource = left.children[0]
    const rightSource = right.children[0]
    const ws = workspace(split([left, right]), right)
    mocks.load.mockReturnValue({ version: 1, root: [[null, pinned(a)], [null, pinned(b)]] })
    await layoutManager.deserialise()
    expect(mocks.replace.mock.calls.map(call => call[1])).toEqual([a, b])
    expect(left.children[0]).toBe(leftSource)
    expect(right.children[0]).toBe(rightSource)
    expect(left.children[1].view.firstRender).toHaveBeenCalledWith(a)
    expect(right.children[1].view.firstRender).toHaveBeenCalledWith(b)
    expect(ws.setActiveLeaf).toHaveBeenLastCalledWith(right.children[1])
    expect(mocks.closeAll).toHaveBeenCalledOnce()
    layoutManager.serialise()
    expect(mocks.save).toHaveBeenLastCalledWith(mocks.load())
  })

  it('restores every tab in a pane without changing subsequent leaf targets during replacement', async () => {
    const left = tabs([markdown(), markdown(), markdown()], 1)
    workspace(split([left, tabs([markdown()])]))
    const targets = [...left.children]
    mocks.load.mockReturnValue({ version: 1, root: [[pinned(a), pinned(b), null], [pinned(c)]] })
    await layoutManager.deserialise()
    expect(mocks.replace.mock.calls[0][0]).toBe(targets[0])
    expect(mocks.replace.mock.calls[1][0]).toBe(targets[1])
    expect(left.children[2]).toBe(targets[2])
    expect(left.currentTab).toBe(1)
  })

  it('reads legacy data relative to the first child and upgrades subsequent saves', async () => {
    const left = tabs([markdown(), markdown()])
    const right = tabs([markdown()])
    workspace(split([left, right]))
    mocks.load.mockReturnValue([null, pinned(a)])
    await layoutManager.deserialise()
    expect(mocks.replace).toHaveBeenCalledOnce()
    expect(mocks.replace.mock.calls[0][1]).toBe(a)
    expect(right.children[0].view.getViewType()).toBe('markdown')
    layoutManager.serialise()
    expect(mocks.save).toHaveBeenCalledWith({ version: 1, root: [[null, pinned(a)], [null]] })
  })

  it('handles empty workspace groups and deleted files without inventing replacement panes', async () => {
    workspace(split([tabs([]), tabs([markdown()])]))
    mocks.load.mockReturnValue({ version: 1, root: [[], [pinned({ path: 'deleted.md', basename: 'deleted' })]] })
    await expect(layoutManager.deserialise()).resolves.toBeUndefined()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('renders the visible mindmap in every root pane, including nested groups', () => {
    const left = tabs([mindmap(a)])
    const right = tabs([mindmap(b)])
    const nested = tabs([mindmap('unpinned')])
    workspace(split([left, split([right, nested])]), right)
    layoutManager.renderVisible()
    expect(left.children[0].view.firstRender).toHaveBeenCalledWith(a)
    expect(right.children[0].view.firstRender).toHaveBeenCalledWith(b)
    expect(nested.children[0].view.firstRender).toHaveBeenCalledWith(mocks.activeFile)
  })
})
