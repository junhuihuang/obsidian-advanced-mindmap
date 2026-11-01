// @vitest-environment jsdom
import type { INode, IPureNode } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyEdit, moveNode, parseSource } from 'src/editing/source-tree'
import { getSourcePath, tagSourcePaths } from 'src/editing/source-paths'
import { createTreeUpdater } from './tree-updater'

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})
const transformer = new Transformer()
const options = { duration: 0, embedGlobalCSS: false, initialExpandLevel: -1 }
const instances: Markmap[] = []
afterEach(() => { instances.splice(0).forEach(mm => mm.destroy()); document.body.innerHTML = '' })

function transformed(markdown: string): IPureNode {
  const { root } = transformer.transform(markdown)
  tagSourcePaths(root, parseSource(markdown))
  return root
}

async function setup(markdown: string, initialExpandLevel = -1) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  document.body.append(svg)
  const mm = Markmap.create(svg, options)
  instances.push(mm)
  mm.transition = (sel: unknown) => sel as never
  const updater = createTreeUpdater(mm)
  await updater.update(transformed(markdown), { ...options, initialExpandLevel }, markdown, 'file')
  const group = (text: string) => Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
    .find(g => g.textContent === text)!
  const data = (text: string): INode => (group(text) as unknown as { __data__: INode }).__data__
  return { svg, mm, updater, group, data }
}

const original = '- a\n  - a1\n- b\n  - b1\n    - b1x\n- c\n'

describe('incremental markmap editing with real data joins', () => {
  it.each(['addChild', 'addSibling'] as const)('%s preserves other nodes, their content DOM and folds despite shifted paths', async type => {
    const { mm, svg, updater, group, data } = await setup(original)
    const b = data('b'), b1 = data('b1')
    await mm.toggleNode(b1)
    await mm.toggleNode(b)
    const before = Array.from(svg.querySelectorAll('g.markmap-node'))
    const bGroup = group('b'), content = bGroup.querySelector('foreignObject')!.firstChild
    const setData = vi.spyOn(mm, 'setData')
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver(records => mutations.push(...records))
    observer.observe(svg, { childList: true, subtree: true })
    const next = applyEdit(original, { type, path: [0], text: 'new' })
    updater.recordChange(original, next, { type: 'insert', path: type === 'addChild' ? [0, 1] : [1] })
    await updater.update(transformed(next), options, next, 'file')
    mutations.push(...observer.takeRecords())
    observer.disconnect()

    expect(setData).not.toHaveBeenCalled()
    expect(before.every(g => g.isConnected)).toBe(true)
    expect(group('b')).toBe(bGroup)
    expect(bGroup.querySelector('foreignObject')!.firstChild).toBe(content)
    expect(data('b')).toBe(b)
    expect(b.payload?.fold).toBe(1)
    expect(b1.payload?.fold).toBe(1)
    expect(getSourcePath(b)).toEqual(type === 'addChild' ? [1] : [2])
    expect(group('b1')).toBeUndefined()
    expect(group('new')).toBeDefined()
    expect(mutations.flatMap(r => Array.from(r.removedNodes))).not.toContain(bGroup)
    expect(mutations.filter(r => bGroup.contains(r.target))).toHaveLength(0)
    await mm.toggleNode(b)
    expect(data('b1')).toBe(b1)
    expect(group('b1x')).toBeUndefined()
  })

  it('reveals only the insertion ancestors, not unrelated or deeper folded branches', async () => {
    const { mm, updater, data, group } = await setup(original)
    await mm.toggleNode(data('b1'))
    await mm.toggleNode(data('b'))
    await mm.toggleNode(data('a'))
    const next = applyEdit(original, { type: 'addChild', path: [1], text: 'new' })
    updater.recordChange(original, next, { type: 'insert', path: [1, 1] })
    await updater.update(transformed(next), options, next, 'file')
    expect(group('new')).toBeDefined()
    expect(data('a').payload?.fold).toBe(1)
    expect(data('b1').payload?.fold).toBe(1)
    expect(group('b1x')).toBeUndefined()
  })

  it('keeps duplicate sibling identities distinct after insertion', async () => {
    const text = '- a\n- same\n  - child\n- same\n  - other\n'
    const { mm, updater } = await setup(text)
    const [a, first, second] = mm.state.data!.children
    await mm.toggleNode(second)
    const next = applyEdit(text, { type: 'addSibling', path: [0], text: 'same' })
    updater.recordChange(text, next, { type: 'insert', path: [1] })
    await updater.update(transformed(next), options, next, 'file')
    expect(mm.state.data!.children[0]).toBe(a)
    expect(mm.state.data!.children[2]).toBe(first)
    expect(mm.state.data!.children[3]).toBe(second)
    expect(second.payload?.fold).toBe(1)
    expect(first.payload?.fold).not.toBe(1)
  })

  it('composes insertions coalesced by the render queue', async () => {
    const { updater, mm, data } = await setup(original)
    const b = data('b')
    await mm.toggleNode(b)
    const one = applyEdit(original, { type: 'addSibling', path: [0], text: 'one' })
    const two = applyEdit(one, { type: 'addSibling', path: [1], text: 'two' })
    updater.recordChange(original, one, { type: 'insert', path: [1] })
    updater.recordChange(one, two, { type: 'insert', path: [2] })
    await updater.update(transformed(two), options, two, 'file')
    expect(data('b')).toBe(b)
    expect(getSourcePath(b)).toEqual([3])
    expect(b.payload?.fold).toBe(1)
    const ids = mm.state.data!.children.map(n => n.state.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renames only the edited label and preserves groups/folds', async () => {
    const { updater, mm, group, data } = await setup(original)
    const aGroup = group('a'), bGroup = group('b'), a = data('a')
    await mm.toggleNode(data('b'))
    const next = applyEdit(original, { type: 'setText', path: [0], text: '**renamed**' })
    updater.recordChange(original, next, { type: 'setText', path: [0] })
    await updater.update(transformed(next), options, next, 'file')
    expect(group('renamed')).toBe(aGroup)
    expect(data('renamed')).toBe(a)
    expect(aGroup.querySelector('strong')?.textContent).toBe('renamed')
    expect(group('b')).toBe(bGroup)
    expect(data('b').payload?.fold).toBe(1)
  })

  it('keeps identity across a rename followed by a child insertion', async () => {
    const { mm, updater, group, data } = await setup(original)
    const a = data('a'), aGroup = group('a')
    const renamed = applyEdit(original, { type: 'setText', path: [0], text: 'renamed' })
    updater.recordChange(original, renamed, { type: 'setText', path: [0] })
    await updater.update(transformed(renamed), options, renamed, 'file')
    const next = applyEdit(renamed, { type: 'addChild', path: [0], text: 'new' })
    updater.recordChange(renamed, next, { type: 'insert', path: [0, 1] })
    await updater.update(transformed(next), options, next, 'file')
    expect(group('renamed')).toBe(aGroup)
    expect(data('renamed')).toBe(a)
    expect(group('new')).toBeDefined()
  })
  it('handles the singleton-to-synthetic-root transition without replacing the existing node', async () => {
    const text = '- a\n  - a1\n'
    const { mm, updater, group, data } = await setup(text)
    const a = data('a'), aGroup = group('a')
    await mm.toggleNode(a)
    const next = applyEdit(text, { type: 'addSibling', path: [0], text: 'b' })
    updater.recordChange(text, next, { type: 'insert', path: [1] })
    await updater.update(transformed(next), options, next, 'file')
    expect(group('a')).toBe(aGroup)
    expect(data('a')).toBe(a)
    expect(a.payload?.fold).toBe(1)
    expect(group('b')).toBeDefined()
  })


  it('preserves manually opened branches under an initial expand limit', async () => {
    const { updater, mm, data, group } = await setup(original, 2)
    await mm.toggleNode(data('b'))
    const next = applyEdit(original, { type: 'addSibling', path: [0], text: 'new' })
    updater.recordChange(original, next, { type: 'insert', path: [1] })
    await updater.update(transformed(next), options, next, 'file')
    expect(group('b1')).toBeDefined()
    expect(group('a1')).toBeUndefined()
  })

  it('moves a node down one sibling position with remove+insert', async () => {
    const text = '- a\n- b\n- c\n'
    const { mm, svg, updater, group, data } = await setup(text)
    const a = data('a'), b = data('b'), c = data('c')
    const bGroup = group('b')
    const setData = vi.spyOn(mm, 'setData')
    const next = moveNode(text, [0], [1], 'after')
    updater.recordChange(text, next.markdown, [{ type: 'remove', path: [0] }, { type: 'insert', path: [1] }])
    await updater.update(transformed(next.markdown), options, next.markdown, 'file')
    expect(setData).not.toHaveBeenCalled()
    // b moved up to index 0; c stayed; a re-appeared at index 1.
    expect(mm.state.data!.children.map(n => n.content)).toEqual(['b', 'a', 'c'])
    expect(group('b')).toBe(bGroup)       // identity of the non-moved node preserved
    expect(data('b')).toBe(b)
    expect(data('c')).toBe(c)
    expect(getSourcePath(b)).toEqual([0])
    expect(getSourcePath(c)).toEqual([2])
  })

    it('moves a node up one sibling position and preserves the folded neighbour', async () => {
    const text = '- a\n  - a1\n- b\n  - b1\n- c\n'
    const { mm, updater, group, data } = await setup(text)
    const a = data('a'), b = data('b'), c = data('c')
    await mm.toggleNode(a)   // fold `a`; the move must keep it folded
    await mm.toggleNode(c)
    const setData = vi.spyOn(mm, 'setData')
    const next = moveNode(text, [1], [0], 'before')  // b up, before a
    updater.recordChange(text, next.markdown, [{ type: 'remove', path: [1] }, { type: 'insert', path: [0] }])
    await updater.update(transformed(next.markdown), options, next.markdown, 'file')
    expect(setData).not.toHaveBeenCalled()
    expect(mm.state.data!.children.map(n => n.content)).toEqual(['b', 'a', 'c'])
    // The neighbours keep their identity and their fold state.
    expect(data('a')).toBe(a)
    expect(a.payload?.fold).toBe(1)
    expect(data('c')).toBe(c)
    expect(c.payload?.fold).toBe(1)
    expect(getSourcePath(a)).toEqual([1])
    expect(getSourcePath(c)).toEqual([2])
  })

  it('does not patch across files/settings or untracked external edits', async () => {
    const { updater, mm } = await setup(original)
    const setData = vi.spyOn(mm, 'setData')
    const next = applyEdit(original, { type: 'addSibling', path: [0], text: 'new' })
    updater.recordChange(original, next, { type: 'insert', path: [1] })
    await updater.update(transformed(next), options, next, 'other-file')
    expect(setData).toHaveBeenCalledOnce()
    setData.mockClear()
    await updater.update(transformed(original), options, original, 'other-file')
    expect(setData).toHaveBeenCalledOnce()
  })

  it('removes a single node and preserves its folded neighbour', async () => {
    const { mm, svg, updater, group, data } = await setup(original)
    const b = data('b'), bGroup = group('b'), c = data('c')
    await mm.toggleNode(b)
    const setData = vi.spyOn(mm, 'setData')
    const next = applyEdit(original, { type: 'remove', path: [0] })
    updater.recordChange(original, next, { type: 'remove', path: [0] })
    await updater.update(transformed(next), options, next, 'file')
    expect(setData).not.toHaveBeenCalled()
    expect(bGroup.isConnected).toBe(true)
    expect(data('b')).toBe(b)
    expect(b.payload?.fold).toBe(1)
    expect(getSourcePath(b)).toEqual([0])
    expect(group('c')).toBeDefined()
    expect(group('a')).toBeUndefined()
  })

  it('removes the last node and re-indexes the preceding sibling that was folded', async () => {
    const text = '- a\n  - a1\n- b\n  - b1\n    - b1x\n- c\n- d\n'
    const { mm, updater, group, data } = await setup(text)
    const d = data('d')
    await mm.toggleNode(d)
    const setData = vi.spyOn(mm, 'setData')
    const next = applyEdit(text, { type: 'remove', path: [2] })
    updater.recordChange(text, next, { type: 'remove', path: [2] })
    await updater.update(transformed(next), options, next, 'file')
    expect(setData).not.toHaveBeenCalled()
    expect(group('d').isConnected).toBe(true)
    expect(data('d')).toBe(d)
    expect(d.payload?.fold).toBe(1)
    expect(getSourcePath(d)).toEqual([2])
    expect(group('c')).toBeUndefined()
    expect(group('a')).toBeDefined()
    expect(group('b')).toBeDefined()
  })
})
