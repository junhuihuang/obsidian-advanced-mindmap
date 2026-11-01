import { describe, expect, it } from 'vitest'

import { resolveDropTarget, type DropBox } from './drop-target'


function box(path: number[], left: number, right: number, top: number, bottom: number): DropBox {
  return { path, left, right, top, bottom }
}

// Three siblings stacked at x = 0..100: [0] above [1] above [2].
const siblings = [
  box([0], 0, 100, 0, 20),
  box([1], 0, 100, 40, 60),
  box([2], 0, 100, 80, 100),
]

describe('resolveDropTarget', () => {
  it('drops onto the middle of a node as a child', () => {
    expect(resolveDropTarget(50, 50, siblings, [0])).toEqual({ position: 'child', path: [1] })
  })

  it('inserts before a node when the pointer is near its top edge', () => {
    expect(resolveDropTarget(50, 42, siblings, [2])).toEqual({ position: 'before', path: [1] })
  })

  it('inserts after a node when the pointer is near its bottom edge', () => {
    expect(resolveDropTarget(50, 58, siblings, [2])).toEqual({ position: 'after', path: [1] })
  })

  it('finds the gap between two siblings and anchors on the nearer one', () => {
    // Halfway between [1] (40..60) and [2] (80..100): nearer [1]'s bottom.
    expect(resolveDropTarget(50, 68, siblings, [0])).toEqual({ position: 'after', path: [1] })
    // Just above [2]: nearer [2]'s top.
    expect(resolveDropTarget(50, 74, siblings, [0])).toEqual({ position: 'before', path: [2] })
  })

  it('never targets the dragged node or its descendants', () => {
    const tree = [
      box([0], 0, 100, 0, 20),
      box([0, 0], 100, 200, 0, 20),
      box([1], 0, 100, 40, 60),
    ]
    // The pointer is over [0, 0], a child of the dragged node [0]: no drop.
    expect(resolveDropTarget(150, 10, tree, [0], [0, 0])).toBeNull()
    // The pointer is over the dragged node's ancestor [0]; ancestors are
    // valid targets (e.g. dragging a grandchild to its grandparent).
    expect(resolveDropTarget(50, 10, tree, [0, 0], [0])).toEqual({ position: 'child', path: [0] })
    // Dragging [0, 0] over the gap above [1]: the nearest remaining node is [1].
    expect(resolveDropTarget(50, 30, tree, [0, 0])).toEqual({ position: 'before', path: [1] })
  })

  it('prefers the hovered node reported by the browser over the box test', () => {
    // All boxes degenerate (jsdom): geometry alone cannot find anything, but the
    // caller reports the node under the pointer, which becomes a child drop.
    const flat = [box([0], 0, 0, 0, 0), box([1], 0, 0, 0, 0)]
    expect(resolveDropTarget(100, 100, flat, [2], [1])).toEqual({ position: 'child', path: [1] })
  })

  it('falls back to child when a hovered node has no height', () => {
    const flat = [box([1], 0, 0, 0, 0)]
    expect(resolveDropTarget(50, 50, flat, [2], [1])).toEqual({ position: 'child', path: [1] })
  })

  it('returns null when nothing is horizontally reachable', () => {
    const far = [box([0], 0, 100, 0, 20)]
    expect(resolveDropTarget(5000, 10, far, [2])).toBeNull()
  })

  it('returns null when the dragged path is the only node', () => {
    expect(resolveDropTarget(50, 50, [box([0], 0, 100, 0, 20)], [0])).toBeNull()
  })

  it('allows dragging a grandchild onto the grandparent as a child', () => {
    // root → [0] → [0, 0] → [0, 0, 0] (grandchild, being dragged)
    // Hovering over [0] (the grandparent): should return child drop.
    const tree = [
      box([], 0, 100, 0, 40),
      box([0], 0, 100, 10, 30),
      box([0, 0], 0, 100, 15, 25),
    ]
    expect(resolveDropTarget(50, 20, tree, [0, 0, 0], [0])).toEqual({ position: 'child', path: [0] })
  })

  it('allows dragging a child to before its parent (reparent up)', () => {
    const tree = [
      box([], 0, 100, 0, 40),
      box([0], 0, 100, 0, 20),
      box([0, 0], 100, 200, 0, 20),
    ]
    // Top edge of [0] with dragged [0, 0]: becomes "before" parent.
    expect(resolveDropTarget(50, 3, tree, [0, 0], [0])).toEqual({ position: 'before', path: [0] })
  })
})
