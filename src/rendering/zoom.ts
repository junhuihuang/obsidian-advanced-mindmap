/**
 * Zoom sensitivity for the mindmap.
 *
 * markmap-view delegates wheel zooming to d3-zoom, whose default wheel delta is:
 *
 *   -deltaY * (deltaMode === 1 ? 0.05 : deltaMode ? 1 : 0.002) * (ctrlKey ? 10 : 1)
 *
 * The `ctrlKey ? 10` boost exists for trackpad pinch, which browsers report as a
 * wheel event with `ctrlKey: true` and a stream of *tiny* deltas. A real mouse
 * wheel also sets `ctrlKey` (Ctrl+wheel) but sends a single *large* delta per
 * notch, so the boost turns a gentle zoom into a ~4x jump. We keep the boost for
 * small (pinch) deltas and drop it for mouse-wheel deltas.
 */

/** Below this |deltaY| a ctrl+wheel event is treated as a trackpad pinch. */
export const PINCH_DELTA_THRESHOLD = 30

/** Upper bound on a single event's delta, i.e. at most a 2^0.5 ≈ 1.41x jump. */
export const MAX_WHEEL_DELTA = 0.5

export type WheelLike = Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>

export function zoomWheelDelta(event: WheelLike): number {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002
  const delta = -event.deltaY * unit
  const isPinch = event.ctrlKey && Math.abs(event.deltaY) <= PINCH_DELTA_THRESHOLD
  return clamp(delta * (isPinch ? 10 : 1), -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Scale applied by one discrete zoom key press (`Shift` + `+` / `-`). */
export const ZOOM_STEP = 1.2

/** Continuous zoom rate while a zoom key is held: this many times per second. */
export const ZOOM_SPEED = 1.8

/** A point in content coordinates used as the fixed center of a zoom. */
export interface ZoomAnchor {
  x: number
  y: number
}

/** A d3-zoom transform: content `(px, py)` is shown at screen `(px*k + x, py*k + y)`. */
export interface ZoomTransform {
  k: number
  x: number
  y: number
}

/**
 * Scale factor for a single animation frame while a zoom key is held for
 * `seconds`. Because the factor composes multiplicatively, applying one factor
 * per frame yields a constant `ZOOM_SPEED`x per second regardless of the frame
 * rate, so the zoom stays smooth from the first frame.
 */
export function holdZoomFactor(seconds: number, zoomingIn: boolean): number {
  return Math.pow(ZOOM_SPEED, seconds * (zoomingIn ? 1 : -1))
}

/**
 * Returns the transform that scales `current` by `factor` while keeping the
 * content point `(px, py)` pinned to its current screen position, i.e. zooming
 * about that point. Passing the center of the selected node keeps the node in
 * place while the rest of the tree grows/shrinks around it.
 */
export function zoomAround(current: ZoomTransform, factor: number, px: number, py: number): ZoomTransform {
  const k = current.k * factor
  // Screen position of the anchor before the scale change. Solving
  // `px * k + x === screenX` for the new `x` keeps it exactly there.
  const screenX = px * current.k + current.x
  const screenY = py * current.k + current.y
  return { k, x: screenX - px * k, y: screenY - py * k }
}

/**
 * Returns the transform that scales `current` by `factor` and places the
 * content point `point` at the center of the `width` x `height` viewport.
 *
 * Unlike `zoomAround` the point is not kept at its current screen position;
 * it is moved to the middle, so the cursor node (or the content as a whole)
 * is always zoomed from the center of the canvas.
 */
export function centerZoom(
  current: ZoomTransform,
  factor: number,
  point: ZoomAnchor,
  width: number,
  height: number,
): ZoomTransform {
  const k = current.k * factor
  // Solving `point.x * k + x === width / 2` for the new translation.
  return { k, x: width / 2 - point.x * k, y: height / 2 - point.y * k }
}

/** A rendered node box, in content coordinates. */
export interface ZoomRect {
  x: number
  y: number
  width: number
  height: number
}

/** Gap kept between a clamped node and the viewport edges, in pixels. */
export const ZOOM_MARGIN = 16

/**
 * Shifts `transform` (without changing its scale) just enough that `rect` stays
 * fully inside a `width` x `height` viewport with a `margin` gap on every side.
 *
 * Centering a whole subtree can push its root off-screen once the zoom gets
 * large; clamping keeps the focused node visible while everything else keeps
 * growing around it. When `rect` is larger than the viewport on an axis its
 * leading (top/left) edge is pinned to the margin instead.
 */
export function clampToViewport(
  transform: ZoomTransform,
  rect: ZoomRect,
  width: number,
  height: number,
  margin = ZOOM_MARGIN,
): ZoomTransform {
  const { k } = transform
  const left = rect.x * k
  const top = rect.y * k
  const w = rect.width * k
  const h = rect.height * k

  // x must satisfy `margin <= rect.x*k + x` and `rect.x*k + x + w <= width - margin`.
  const minX = margin - left
  const maxX = width - margin - w - left
  const x = minX <= maxX ? clamp(transform.x, minX, maxX) : minX

  const minY = margin - top
  const maxY = height - margin - h - top
  const y = minY <= maxY ? clamp(transform.y, minY, maxY) : minY

  return { k, x, y }
}

/**
 * Center of the bounding box covering every rect, in content coordinates.
 * Returns `undefined` when there is nothing to measure.
 */
export function contentCenter(rects: ZoomRect[]): ZoomAnchor | undefined {
  if (rects.length === 0) return undefined

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/** A rendered node and its children, used to measure a subtree's extent. */
export interface ZoomTree {
  rect?: ZoomRect
  children?: ZoomTree[]
}

/**
 * Center of the bounding box covering a whole subtree.
 *
 * Because a mindmap grows from left to right, this point sits to the *right* of
 * the subtree's root whenever the subtree has children. Centering it therefore
 * parks the root in the left part of the canvas and lets its descendants fill
 * the rest, instead of leaving the left half empty.
 */
export function treeCenter(root: ZoomTree): ZoomAnchor | undefined {
  const rects: ZoomRect[] = []

  const walk = (node: ZoomTree) => {
    if (node.rect) rects.push(node.rect)
    node.children?.forEach(walk)
  }
  walk(root)

  return contentCenter(rects)
}
