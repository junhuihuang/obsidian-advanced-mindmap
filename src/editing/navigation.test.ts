import { describe, expect, it } from 'vitest'

import { findNodeInDirection, isDescendantPath, nearestPath } from './navigation'


// Visible nodes in pre-order:
//
//   [0]            level 1
//     [0,0]        level 2
//     [0,1]        level 2
//       [0,1,0]    level 3
//     [0,2]        level 2
//   [1]            level 1
//     [1,0]        level 2
const ordered = [[0], [0, 0], [0, 1], [0, 1, 0], [0, 2], [1], [1, 0]]

// Same tree, but with the synthetic markmap root (`[]`) rendered first.
const orderedWithRoot = [[], [0], [0, 0], [0, 1], [0, 1, 0], [0, 2], [1], [1, 0]]

// "Plain text as nodes" switched off: the paragraph `[0, 0]` is not on the
// canvas, so its list items hang one level below the heading `[0]` and the
// source paths are deeper than the levels the map draws.
//
//   [0]            level 1
//     [0,0,0]      level 2  (item of the paragraph `[0,0]`)
//     [0,0,1]      level 2
//     [0,1]        level 2
//       [0,1,0]    level 3
const withoutProse = [[0], [0, 0, 0], [0, 0, 1], [0, 1], [0, 1, 0]]

describe('findNodeInDirection', () => {
  it('moves down to the next sibling', () => {
    expect(findNodeInDirection(ordered, [0, 0], 'down')).toEqual([0, 1])
    expect(findNodeInDirection(ordered, [0, 1], 'down')).toEqual([0, 2])
    expect(findNodeInDirection(ordered, [0], 'down')).toEqual([1])
  })

  it('continues down to the nearest node at the same level when siblings run out', () => {
    expect(findNodeInDirection(ordered, [0, 2], 'down')).toEqual([1, 0])
  })

  it('moves up to the previous sibling', () => {
    expect(findNodeInDirection(ordered, [0, 1], 'up')).toEqual([0, 0])
    expect(findNodeInDirection(ordered, [0, 2], 'up')).toEqual([0, 1])
    expect(findNodeInDirection(ordered, [1], 'up')).toEqual([0])
  })

  it('continues up to the nearest node at the same level when siblings run out', () => {
    expect(findNodeInDirection(ordered, [1, 0], 'up')).toEqual([0, 2])
  })

  it('moves left to the parent', () => {
    expect(findNodeInDirection(ordered, [0, 1, 0], 'left')).toEqual([0, 1])
    expect(findNodeInDirection(ordered, [0, 2], 'left')).toEqual([0])
    expect(findNodeInDirection(ordered, [1, 0], 'left')).toEqual([1])
  })

  it('moves right to the first child', () => {
    expect(findNodeInDirection(ordered, [0], 'right')).toEqual([0, 0])
    expect(findNodeInDirection(ordered, [0, 1], 'right')).toEqual([0, 1, 0])
    expect(findNodeInDirection(ordered, [1], 'right')).toEqual([1, 0])
  })

  it('returns undefined at the very top and bottom of a level', () => {
    expect(findNodeInDirection(ordered, [0, 0], 'up')).toBeUndefined()
    expect(findNodeInDirection(ordered, [1], 'down')).toBeUndefined()
    expect(findNodeInDirection(ordered, [0, 1, 0], 'down')).toBeUndefined()
    expect(findNodeInDirection(ordered, [0, 1, 0], 'up')).toBeUndefined()
  })

  it('does not move right to a sibling or left at the root', () => {
    expect(findNodeInDirection(ordered, [0, 0], 'right')).toBeUndefined()
    expect(findNodeInDirection(ordered, [0], 'left')).toBeUndefined()
  })

  it('does not move to a hidden child', () => {
    const folded = [[0], [0, 0]]
    expect(findNodeInDirection(folded, [0, 0], 'right')).toBeUndefined()
  })

  describe('with plain-text nodes switched off', () => {
    it('skips an unrendered paragraph between parent and child', () => {
      expect(findNodeInDirection(withoutProse, [0], 'right')).toEqual([0, 0, 0])
      expect(findNodeInDirection(withoutProse, [0, 0, 0], 'left')).toEqual([0])
    })

    it('compares the rendered depth instead of the path length', () => {
      // Previous sibling first, then across to the same rendered level.
      expect(findNodeInDirection(withoutProse, [0, 0, 0], 'down')).toEqual([0, 0, 1])
      expect(findNodeInDirection(withoutProse, [0, 0, 1], 'down')).toEqual([0, 1])
      expect(findNodeInDirection(withoutProse, [0, 1], 'up')).toEqual([0, 0, 1])
      // `[0,1,0]` is a child of `[0,1]`, not a sibling of the list items.
      expect(findNodeInDirection(withoutProse, [0, 0, 1], 'down')).not.toEqual([0, 1, 0])
      expect(findNodeInDirection(withoutProse, [0, 1], 'right')).toEqual([0, 1, 0])
    })
  })

  describe('with the synthetic root rendered', () => {
    it('moves left from a top-level node to the root', () => {
      expect(findNodeInDirection(orderedWithRoot, [0], 'left')).toEqual([])
      expect(findNodeInDirection(orderedWithRoot, [1], 'left')).toEqual([])
    })

    it('moves right from the root to its first child', () => {
      expect(findNodeInDirection(orderedWithRoot, [], 'right')).toEqual([0])
    })

    it('does not move left from the root', () => {
      expect(findNodeInDirection(orderedWithRoot, [], 'left')).toBeUndefined()
    })

    it('does not step up to an unrendered root', () => {
      expect(findNodeInDirection(ordered, [0], 'left')).toBeUndefined()
    })

    it('keeps up/down within a level, ignoring the root', () => {
      expect(findNodeInDirection(orderedWithRoot, [0], 'down')).toEqual([1])
      expect(findNodeInDirection(orderedWithRoot, [1], 'up')).toEqual([0])
    })
  })
})

describe('isDescendantPath', () => {
  it('is true for nodes nested below the ancestor', () => {
    expect(isDescendantPath([0], [0, 1])).toBe(true)
    expect(isDescendantPath([0, 1], [0, 1, 2])).toBe(true)
  })

  it('is false for the node itself', () => {
    expect(isDescendantPath([0, 1], [0, 1])).toBe(false)
  })

  it('is false for siblings and unrelated nodes', () => {
    expect(isDescendantPath([0, 1], [0, 2])).toBe(false)
    expect(isDescendantPath([0, 1], [1, 1])).toBe(false)
    expect(isDescendantPath([0, 1], [0])).toBe(false)
  })
})

describe('nearestPath', () => {
  const positions = [
    { path: [0], x: 400, y: 300 },
    { path: [0, 0], x: 100, y: 100 },
    { path: [0, 1], x: 500, y: 400 },
    { path: [1], x: 900, y: 300 },
  ]

  it('picks the node closest to the point', () => {
    expect(nearestPath(positions, 480, 380)).toEqual([0, 1])
    expect(nearestPath(positions, 120, 90)).toEqual([0, 0])
    expect(nearestPath(positions, 700, 300)).toEqual([1])
  })

  it('compares in both axes, not just horizontally', () => {
    // (0,1) shares the point's x but (0) is closer overall thanks to y.
    expect(nearestPath(positions, 500, 0)).toEqual([0])
  })

  it('prefers the earlier node on a tie', () => {
    const tied = [
      { path: [0, 0], x: 0, y: 0 },
      { path: [0, 1], x: 0, y: 0 },
    ]
    expect(nearestPath(tied, 0, 0)).toEqual([0, 0])
  })

  it('returns undefined when there are no nodes', () => {
    expect(nearestPath([], 0, 0)).toBeUndefined()
  })
})
