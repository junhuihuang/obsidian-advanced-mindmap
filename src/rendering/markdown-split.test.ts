// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFile, WorkspaceLeaf } from 'obsidian'
import { createMarkdownSplit } from './markdown-split'

/** A leaf whose container is really on screen, like Obsidian's own leaves. */
function fakeLeaf(): WorkspaceLeaf {
  const containerEl = document.createElement('div')
  document.body.append(containerEl)
  return { view: { containerEl }, openFile: vi.fn(), detach: vi.fn() } as unknown as WorkspaceLeaf
}

function setup(options: { file?: TFile } = {}) {
  const owner = fakeLeaf()
  const created = fakeLeaf()

  const changes: boolean[] = []
  let layoutHandler: (() => void) | null = null
  const workspace = {
    createLeafBySplit: vi.fn(() => created),
    on: vi.fn((_name: 'layout-change', callback: () => void) => {
      layoutHandler = callback
      return {} as never
    }),
    offref: vi.fn(() => { layoutHandler = null }),
  }

  const file = options.file ?? { path: 'note.md', basename: 'note' } as TFile
  const handle = createMarkdownSplit({
    leaf: owner,
    getFile: () => (options.file === undefined ? file : options.file),
    onChange: open => changes.push(open),
    workspace,
  })

  return {
    handle,
    workspace,
    owner,
    created,
    changes,
    file,
    fireLayoutChange: () => layoutHandler?.(),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('markdown split', () => {
  it('starts closed', () => {
    const { handle } = setup()
    expect(handle.isOpen()).toBe(false)
  })

  it('opens the note in a split next to the mindmap leaf', async () => {
    const { handle, workspace, owner, created, file, changes } = setup()

    await handle.toggle()

    expect(workspace.createLeafBySplit).toHaveBeenCalledWith(owner, 'vertical')
    expect(created.openFile).toHaveBeenCalledWith(file, { active: true })
    expect(changes).toEqual([true])
  })

  it('uses Obsidian\'s own view so the note keeps its last mode', async () => {
    const { handle, created, file } = setup()
    await handle.toggle()
    // No `state` is passed: `openFile` reuses the file's remembered mode
    // (source, live preview or reading), which is the native behaviour.
    expect(created.openFile).toHaveBeenCalledWith(file, { active: true })
  })

  it('closes the split again when toggled twice', async () => {
    const { handle, created, changes } = setup()
    await handle.toggle()
    await handle.toggle()

    expect(created.detach).toHaveBeenCalledOnce()
    expect(handle.isOpen()).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('opens a fresh split after the previous one was closed by hand', async () => {
    const { handle, workspace, created, fireLayoutChange } = setup()
    await handle.toggle()

    // The user closes the split themselves: its container leaves the document.
    created.view.containerEl.remove()
    fireLayoutChange()

    expect(handle.isOpen()).toBe(false)
    await handle.toggle()
    expect(workspace.createLeafBySplit).toHaveBeenCalledTimes(2)
  })

  it('reports the closed state when the split disappears', async () => {
    const { handle, created, fireLayoutChange, changes } = setup()
    await handle.toggle()
    created.view.containerEl.remove()
    fireLayoutChange()
    expect(changes).toEqual([true, false])
  })

  it('does nothing without a rendered note', async () => {
    const { workspace, owner } = setup()
    const handle = createMarkdownSplit({
      leaf: owner,
      getFile: () => undefined,
      workspace,
    })
    await handle.toggle()
    expect(workspace.createLeafBySplit).not.toHaveBeenCalled()
  })

  it('ignores the layout change that happens while the split is still opening', async () => {
    const { handle, created, fireLayoutChange, workspace } = setup()
    let finish!: () => void
    created.openFile = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    created.view.containerEl.remove() // not in the document while opening

    const opening = handle.toggle()
    fireLayoutChange()
    finish()
    await opening

    expect(handle.isOpen()).toBe(false) // the fake container is still detached
    expect(created.detach).not.toHaveBeenCalled()
    // The split is remembered: opening again after the container mounts must
    // not create a second one.
    document.body.append(created.view.containerEl)
    expect(handle.isOpen()).toBe(true)
    await handle.toggle()
    expect(workspace.createLeafBySplit).toHaveBeenCalledOnce()
    expect(created.detach).toHaveBeenCalledOnce()
  })

  it('stops reacting to the layout after destroy', async () => {
    const { handle, workspace, created, fireLayoutChange, changes } = setup()
    await handle.toggle()
    handle.destroy()

    expect(workspace.offref).toHaveBeenCalledOnce()
    created.view.containerEl.remove()
    fireLayoutChange()
    expect(changes).toEqual([true])
  })

  it('does not create a split after destroy', async () => {
    const { handle, workspace } = setup()
    handle.destroy()
    await handle.toggle()
    expect(workspace.createLeafBySplit).not.toHaveBeenCalled()
  })
})
