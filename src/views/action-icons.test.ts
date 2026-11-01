// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { MARKDOWN_SOURCE_ICON_PATH, setMarkdownSourceIcon } from './action-icons'

describe('setMarkdownSourceIcon', () => {
  it('draws the filled markmap-toolbar glyph inside the action', () => {
    const action = document.createElement('div')
    action.classList.add('clickable-icon')
    action.setAttribute('aria-label', "Open the note's markdown in a split")
    action.appendChild(document.createElement('span'))

    setMarkdownSourceIcon(action)

    expect(action.querySelector('span')).toBeNull()

    const svg = action.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.classList.contains('svg-icon')).toBe(true)
    expect(svg?.classList.contains('advmm-markdown-source-icon')).toBe(true)
    // Lucide icons are stroked; the toolbar glyph is filled.
    expect(svg?.style.fill.toLowerCase()).toBe('currentcolor')
    expect(svg?.style.stroke).toBe('none')

    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(MARKDOWN_SOURCE_ICON_PATH)
    // The tooltip/label survive the swap.
    expect(action.getAttribute('aria-label')).toBe("Open the note's markdown in a split")
  })
})
