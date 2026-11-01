import { describe, expect, it, vi } from 'vitest'
import { renderedTreeCenter, renderedNodeRect } from './rendered-geometry'

function fixture(size = 100) {
  const root: any = { children: [] }
  const nodes = [root]
  for (let i = 1; i < size; i++) {
    const node = { children: [], state: { rect: { x: i * 10, y: 0, width: 10, height: 20 } } }
    root.children.push(node)
    nodes.push(node)
  }
  root.state = { rect: { x: 0, y: 0, width: 10, height: 20 } }
  const selectAll = vi.fn(() => ({ each: (fn: (this: any, data: any) => void) => nodes.forEach(node => fn.call({}, node)) }))
  return { root, nodes, selectAll, markmap: { g: { selectAll } } as any }
}

describe('rendered subtree geometry', () => {
  it('measures a large subtree with one rendered-node scan, not one scan per descendant', () => {
    const { root, markmap, selectAll } = fixture(2000)
    expect(renderedTreeCenter(markmap, root)).toEqual({ x: 10000, y: 10 })
    expect(selectAll).toHaveBeenCalledOnce()
  })

  it('ignores folded/unrendered descendants and unrelated nodes', () => {
    const { root, nodes, markmap } = fixture(3)
    const hidden = { state: { rect: { x: 9999, y: 9999, width: 50, height: 50 } }, children: [] }
    nodes[1].children.push(hidden)
    expect(renderedTreeCenter(markmap, nodes[1])).toEqual({ x: 15, y: 10 })
    expect(renderedTreeCenter(markmap, hidden as any)).toBeUndefined()
    expect(renderedTreeCenter(markmap, root)).toEqual({ x: 15, y: 10 })
  })

  it('returns a rect only for a currently rendered node', () => {
    const { nodes, markmap } = fixture(2)
    expect(renderedNodeRect(markmap, nodes[1])).toBe(nodes[1].state.rect)
    expect(renderedNodeRect(markmap, { children: [] } as any)).toBeUndefined()
  })
})
