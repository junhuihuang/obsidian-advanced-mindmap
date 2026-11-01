import { describe, expect, it } from 'vitest'

import { directionForKey } from './keymap'


describe('directionForKey', () => {
  it('maps arrow keys', () => {
    expect(directionForKey('ArrowUp')).toBe('up')
    expect(directionForKey('ArrowDown')).toBe('down')
    expect(directionForKey('ArrowLeft')).toBe('left')
    expect(directionForKey('ArrowRight')).toBe('right')
  })

  it('maps vim keys', () => {
    expect(directionForKey('k')).toBe('up')
    expect(directionForKey('j')).toBe('down')
    expect(directionForKey('h')).toBe('left')
    expect(directionForKey('l')).toBe('right')
  })

  it('does not navigate on uppercase vim keys (J/K move nodes)', () => {
    expect(directionForKey('K')).toBeUndefined()
    expect(directionForKey('J')).toBeUndefined()
    expect(directionForKey('H')).toBeUndefined()
    expect(directionForKey('L')).toBeUndefined()
  })

  it('ignores other keys', () => {
    expect(directionForKey('a')).toBeUndefined()
    expect(directionForKey('Tab')).toBeUndefined()
    expect(directionForKey('Enter')).toBeUndefined()
    expect(directionForKey('Backspace')).toBeUndefined()
  })
})
