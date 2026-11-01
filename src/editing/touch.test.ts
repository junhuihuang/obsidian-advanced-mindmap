import { describe, expect, it } from 'vitest'

import {
  DOUBLE_TAP_DISTANCE_SQUARED,
  DOUBLE_TAP_MS,
  isDoubleTap,
  movedBeyondThreshold,
  tapAction,
  type TapPoint,
} from './touch'


describe('movedBeyondThreshold', () => {
  it('ignores small movements (a held finger drifts a little)', () => {
    expect(movedBeyondThreshold(100, 100, 101, 101)).toBe(false)
    expect(movedBeyondThreshold(100, 100, 104, 100)).toBe(false)
  })

  it('detects a real pan once the finger travels far enough', () => {
    expect(movedBeyondThreshold(100, 100, 110, 100)).toBe(true)
    expect(movedBeyondThreshold(100, 100, 100, 90)).toBe(true)
    expect(movedBeyondThreshold(100, 100, 80, 100)).toBe(true)
  })
})

describe('isDoubleTap', () => {
  const first: TapPoint = { time: 1000, x: 50, y: 50 }

  it('is false without a previous tap', () => {
    expect(isDoubleTap(null, 1000, 50, 50)).toBe(false)
  })

  it('is true for a quick second tap at the same spot', () => {
    expect(isDoubleTap(first, 1000 + DOUBLE_TAP_MS, 50, 50)).toBe(true)
  })

  it('is false when the second tap is too late', () => {
    expect(isDoubleTap(first, 1000 + DOUBLE_TAP_MS + 1, 50, 50)).toBe(false)
  })

  it('is false when the second tap is too far away', () => {
    const far = Math.sqrt(DOUBLE_TAP_DISTANCE_SQUARED) + 1
    expect(isDoubleTap(first, 1100, 50 + far, 50)).toBe(false)
  })

  it('tolerates a small distance between the taps', () => {
    expect(isDoubleTap(first, 1100, 53, 54)).toBe(true)
  })
})

describe('tapAction', () => {
  it('deselects when tapping empty canvas', () => {
    expect(tapAction({ onNode: false, doubleTap: false })).toBe('deselect')
    expect(tapAction({ onNode: false, doubleTap: true })).toBe('deselect')
  })

  it('selects a node on a single tap', () => {
    expect(tapAction({ onNode: true, doubleTap: false })).toBe('select')
  })

  it('edits a node on a double tap', () => {
    expect(tapAction({ onNode: true, doubleTap: true })).toBe('edit')
  })
})
