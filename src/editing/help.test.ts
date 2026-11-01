import { describe, expect, it } from 'vitest'

import { HELP_SECTIONS } from './help'
import { FOLD_HINTS } from './fold-hints'

describe('HELP_SECTIONS', () => {
  it('covers navigation, editing, view and mouse', () => {
    expect(HELP_SECTIONS.map(section => section.id)).toEqual(['navigation', 'editing', 'view', 'mouse'])
  })

  it('every entry has keys and a label', () => {
    for (const section of HELP_SECTIONS) {
      expect(section.entries.length).toBeGreaterThan(0)
      for (const entry of section.entries) {
        expect(entry.keys.length).toBeGreaterThan(0)
        expect(entry.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('includes the help key itself and the search key', () => {
    const labels = HELP_SECTIONS.flatMap(section => section.entries.map(entry => entry.label))
    expect(labels).toContain('help')
    expect(labels).toContain('search')
  })

  it('documents the zoom shortcut', () => {
    const labels = HELP_SECTIONS.flatMap(section => section.entries.map(entry => entry.label))
    expect(labels).toContain('zoom')
  })

  // `zC` used to be a silent alias of `zc`, so the whole-tree fold was missing
  // from every hint. Every fold command has to be discoverable from the overlay.
  it('lists every fold command, and only those', () => {
    const foldKeys = HELP_SECTIONS.flatMap(section => section.entries)
      .filter(entry => entry.keys.startsWith('z '))
      .map(entry => entry.label)
      .sort()
    const commands = FOLD_HINTS.map(hint => hint.action as string).sort()
    expect(foldKeys).toEqual(commands)
  })

  it('names the whole-tree fold on zC', () => {
    const entries = HELP_SECTIONS.flatMap(section => section.entries)
    expect(entries).toContainEqual({ keys: 'z C', label: 'foldLevel' })
  })
})
