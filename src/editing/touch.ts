/** Delay (ms) a finger must stay still before it becomes a long press. */
export const LONG_PRESS_MS = 450

/** Squared distance (px) a finger may travel before it counts as a pan. */
export const MOVE_THRESHOLD_SQUARED = 100

/** Maximum delay (ms) between two taps for them to count as a double tap. */
export const DOUBLE_TAP_MS = 300

/** Maximum squared distance (px) between two taps of a double tap. */
export const DOUBLE_TAP_DISTANCE_SQUARED = 400

/** A completed tap: when and where it happened. */
export interface TapPoint {
  time: number
  x: number
  y: number
}

/** True once the pointer has moved far enough from where it landed to pan. */
export function movedBeyondThreshold(startX: number, startY: number, x: number, y: number): boolean {
  const dx = x - startX
  const dy = y - startY
  return dx * dx + dy * dy >= MOVE_THRESHOLD_SQUARED
}

/** True when `time`/`x`/`y` form the second tap of a double tap on a node. */
export function isDoubleTap(previous: TapPoint | null, time: number, x: number, y: number): boolean {
  if (!previous) return false
  if (time < previous.time || time - previous.time > DOUBLE_TAP_MS) return false

  const dx = x - previous.x
  const dy = y - previous.y
  return dx * dx + dy * dy <= DOUBLE_TAP_DISTANCE_SQUARED
}

export type TapAction = 'edit' | 'select' | 'deselect'

/**
 * What a completed tap should do: tapping empty canvas deselects, tapping a
 * node selects it, and a double tap on a node opens the inline editor.
 */
export function tapAction(options: { onNode: boolean; doubleTap: boolean }): TapAction {
  if (!options.onNode) return 'deselect'
  return options.doubleTap ? 'edit' : 'select'
}
