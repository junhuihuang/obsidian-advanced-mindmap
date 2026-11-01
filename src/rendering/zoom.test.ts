import { describe, expect, it } from 'vitest'

import { PINCH_DELTA_THRESHOLD, ZOOM_MARGIN, centerZoom, clampToViewport, contentCenter, holdZoomFactor, treeCenter, zoomAround, zoomWheelDelta, ZOOM_SPEED } from './zoom'


const wheel = (deltaY: number, opts: Partial<WheelEvent> = {}) =>
  ({ deltaY, deltaMode: 0, ctrlKey: false, ...opts }) as WheelEvent


describe('zoomWheelDelta', () => {
  it('does not apply the 10x ctrl boost to a mouse-wheel notch', () => {
    // A real mouse wheel sends one large delta per notch. d3-zoom's default
    // would multiply it by 10 (because ctrlKey is set for Ctrl+wheel), which is
    // what made each notch jump ~4x. We want the plain wheel speed instead.
    expect(zoomWheelDelta(wheel(120, { ctrlKey: true }))).toBeCloseTo(-0.24)
    expect(zoomWheelDelta(wheel(100, { ctrlKey: true }))).toBeCloseTo(-0.2)
  })

  it('keeps the 10x ctrl boost for small (trackpad pinch) deltas', () => {
    expect(zoomWheelDelta(wheel(5, { ctrlKey: true }))).toBeCloseTo(-0.1)
    expect(zoomWheelDelta(wheel(3, { ctrlKey: true }))).toBeCloseTo(-0.06)
  })

  it('matches d3 default for a plain (non-ctrl) wheel', () => {
    expect(zoomWheelDelta(wheel(120))).toBeCloseTo(-0.24)
    expect(zoomWheelDelta(wheel(-120))).toBeCloseTo(0.24)
  })

  it('honours deltaMode lines', () => {
    expect(zoomWheelDelta(wheel(3, { deltaMode: 1 }))).toBeCloseTo(-0.15)
  })

  it('clamps a single event so it cannot jump more than ~1.41x', () => {
    expect(zoomWheelDelta(wheel(1000, { ctrlKey: true }))).toBe(-0.5)
    expect(zoomWheelDelta(wheel(-1000, { ctrlKey: true }))).toBe(0.5)
  })

  it('treats deltas just under the pinch threshold as pinch', () => {
    const atThreshold = zoomWheelDelta(wheel(PINCH_DELTA_THRESHOLD, { ctrlKey: true }))
    const aboveThreshold = zoomWheelDelta(wheel(PINCH_DELTA_THRESHOLD + 100, { ctrlKey: true }))
    expect(atThreshold).toBeLessThan(aboveThreshold)
  })
})

describe('zoomAround', () => {
  it('scales around the given point, keeping it pinned on screen', () => {
    const current = { k: 1, x: 0, y: 0 }
    const next = zoomAround(current, 1.2, 100, 50)

    expect(next.k).toBeCloseTo(1.2)
    // The content point (100, 50) must land on the same screen position.
    expect(100 * next.k + next.x).toBeCloseTo(100 * current.k + current.x)
    expect(50 * next.k + next.y).toBeCloseTo(50 * current.k + current.y)
  })

  it('keeps the point pinned when zooming out', () => {
    const current = { k: 2, x: 30, y: -40 }
    const next = zoomAround(current, 1 / 1.2, 10, 20)

    expect(next.k).toBeCloseTo(2 / 1.2)
    expect(10 * next.k + next.x).toBeCloseTo(10 * current.k + current.x)
    expect(20 * next.k + next.y).toBeCloseTo(20 * current.k + current.y)
  })

  it('returns the same transform for a factor of 1', () => {
    const current = { k: 1.5, x: 12, y: -7 }
    const next = zoomAround(current, 1, 33, 44)

    expect(next.k).toBeCloseTo(current.k)
    expect(next.x).toBeCloseTo(current.x)
    expect(next.y).toBeCloseTo(current.y)
  })
})

describe('centerZoom', () => {
  it('scales by the factor and moves the anchor to the viewport center', () => {
    const next = centerZoom({ k: 1, x: 0, y: 0 }, 1.2, { x: 300, y: 200 }, 800, 600)

    expect(next.k).toBeCloseTo(1.2)
    // Content point (300, 200) must land on the viewport center (400, 300).
    expect(300 * next.k + next.x).toBeCloseTo(400)
    expect(200 * next.k + next.y).toBeCloseTo(300)
  })

  it('re-centers an off-center anchor even at scale 1', () => {
    const next = centerZoom({ k: 1, x: 0, y: 0 }, 1, { x: 10, y: 10 }, 800, 600)

    expect(10 * next.k + next.x).toBeCloseTo(400)
    expect(10 * next.k + next.y).toBeCloseTo(300)
  })

  it('keeps the anchor centered across repeated zooms', () => {
    let next = centerZoom({ k: 1, x: 0, y: 0 }, 1.2, { x: 300, y: 200 }, 800, 600)
    next = centerZoom(next, 1 / 1.2, { x: 300, y: 200 }, 800, 600)

    expect(300 * next.k + next.x).toBeCloseTo(400)
    expect(200 * next.k + next.y).toBeCloseTo(300)
  })
})

describe('contentCenter', () => {
  it('returns undefined when there is nothing to measure', () => {
    expect(contentCenter([])).toBeUndefined()
  })

  it('returns the center of the bounding box of all rects', () => {
    expect(contentCenter([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 90, y: 40, width: 10, height: 20 },
    ])).toEqual({ x: 50, y: 30 })
  })

  it('handles a single rect', () => {
    expect(contentCenter([{ x: 5, y: 5, width: 20, height: 10 }])).toEqual({ x: 15, y: 10 })
  })
})

describe('treeCenter', () => {
  it('returns undefined for a tree with no rects', () => {
    expect(treeCenter({ children: [] })).toBeUndefined()
  })

  it('returns the center of a single node', () => {
    expect(treeCenter({ rect: { x: 0, y: 0, width: 10, height: 10 } })).toEqual({ x: 5, y: 5 })
  })

  it('covers the whole subtree, not just the root', () => {
    const tree = {
      rect: { x: 0, y: 40, width: 10, height: 10 },
      children: [
        { rect: { x: 100, y: 0, width: 10, height: 10 } },
        { rect: { x: 100, y: 80, width: 10, height: 10 } },
      ],
    }

    // Bounding box spans x 0..110 and y 0..90 => center (55, 45).
    expect(treeCenter(tree)).toEqual({ x: 55, y: 45 })
  })

  it('places the center to the right of a root whose subtree grows right', () => {
    const tree = {
      rect: { x: 0, y: 0, width: 20, height: 20 },
      children: [{ rect: { x: 200, y: 0, width: 20, height: 20 } }],
    }

    // The node itself is at x=10 but the subtree center is at x=110, so the
    // node ends up left of the canvas center while its children fill the right.
    expect(treeCenter(tree)!.x).toBeGreaterThan(10)
  })
})

describe('clampToViewport', () => {
  const width = 800
  const height = 600
  const node = { x: 0, y: 0, width: 100, height: 20 }

  it('leaves an already visible rect untouched', () => {
    const transform = { k: 1, x: 100, y: 100 }
    expect(clampToViewport(transform, node, width, height)).toEqual(transform)
  })

  it('pulls a node overflowing the left edge back in', () => {
    // The node's left edge would land 50px off-screen to the left.
    const out = clampToViewport({ k: 1, x: -50, y: 100 }, node, width, height)
    expect(node.x * out.k + out.x).toBeCloseTo(ZOOM_MARGIN)
  })

  it('pulls a node overflowing the right edge back in', () => {
    const out = clampToViewport({ k: 1, x: 780, y: 100 }, node, width, height)
    expect((node.x + node.width) * out.k + out.x).toBeCloseTo(width - ZOOM_MARGIN)
  })

  it('pulls a node overflowing the top and bottom edges back in', () => {
    const top = clampToViewport({ k: 1, x: 100, y: -50 }, node, width, height)
    expect(node.y * top.k + top.y).toBeCloseTo(ZOOM_MARGIN)

    const bottom = clampToViewport({ k: 1, x: 100, y: 590 }, node, width, height)
    expect((node.y + node.height) * bottom.k + bottom.y).toBeCloseTo(height - ZOOM_MARGIN)
  })

  it('keeps the scale so the zoom itself is not cancelled', () => {
    const out = clampToViewport({ k: 4, x: -1000, y: 50 }, node, width, height)
    expect(out.k).toBe(4)
    expect(node.x * out.k + out.x).toBeCloseTo(ZOOM_MARGIN)
  })

  it('pins the leading edge when the node is wider than the viewport', () => {
    const wide = { x: 0, y: 0, width: 1000, height: 20 }
    const out = clampToViewport({ k: 1, x: 100, y: 100 }, wide, width, height)
    expect(wide.x * out.k + out.x).toBeCloseTo(ZOOM_MARGIN)
  })
})

describe('holdZoomFactor', () => {
  it('does not change the scale for a zero-length frame', () => {
    expect(holdZoomFactor(0, true)).toBe(1)
    expect(holdZoomFactor(0, false)).toBe(1)
  })

  it('scales by ZOOM_SPEED per second when zooming in', () => {
    expect(holdZoomFactor(1, true)).toBeCloseTo(ZOOM_SPEED)
    expect(holdZoomFactor(0.5, true)).toBeCloseTo(Math.sqrt(ZOOM_SPEED))
  })

  it('scales by 1 / ZOOM_SPEED per second when zooming out', () => {
    expect(holdZoomFactor(1, false)).toBeCloseTo(1 / ZOOM_SPEED)
  })

  it('composes so the speed is independent of the frame rate', () => {
    // Two 8ms frames should equal one 16ms frame.
    const split = holdZoomFactor(0.008, true) * holdZoomFactor(0.008, true)
    expect(split).toBeCloseTo(holdZoomFactor(0.016, true))
  })
})
