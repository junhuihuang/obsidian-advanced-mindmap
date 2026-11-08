import { describe, expect, it } from 'vitest'

import { nextProseMode, PROSE_MODES, proseTransformOptions } from './prose-mode'


describe('plain-text modes', () => {
  it('draws every paragraph in `always`', () => {
    expect(proseTransformOptions('always')).toEqual({ prose: true, structuralOnly: false })
  })

  it('draws only the paragraphs that introduce a block in `smart`', () => {
    expect(proseTransformOptions('smart')).toEqual({ prose: true, structuralOnly: true })
  })

  it('draws no paragraph at all in `never`', () => {
    expect(proseTransformOptions('never')).toEqual({ prose: false, structuralOnly: false })
  })

  it('cycles through every mode and back', () => {
    let mode = PROSE_MODES[0]
    const seen = [mode]
    for (let i = 1; i < PROSE_MODES.length; i++) {
      mode = nextProseMode(mode)
      seen.push(mode)
    }
    expect(seen).toEqual(['always', 'smart', 'never'])
    expect(nextProseMode(mode)).toBe('always')
  })
})
