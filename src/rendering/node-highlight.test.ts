import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The node highlight rules are pure CSS, so the only way to guard them is to
// inspect the shipped stylesheet directly.
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')

/** Body of the first rule whose selector list contains `selector`. */
function ruleFor(selector: string): string | undefined {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].includes(selector)) return match[2]
  }
  return undefined
}

describe('node label background shape', () => {
  // `==highlighted==` text becomes `<mark>`; markmap paints it with a plain
  // rectangle, which clashes with the rounded node/selection box.
  it('rounds highlighted (`==…==`) text like the node box', () => {
    expect(ruleFor('.markmap-foreign mark')).toMatch(/border-radius:\s*var\(--radius-s\)/)
  })

  // Per-node `<!-- bgColor: … -->` labels are rendered as a styled `<span>`.
  it('rounds per-node `bgColor` labels', () => {
    expect(ruleFor("span[style*='background-color']")).toMatch(/border-radius:\s*var\(--radius-s\)/)
  })

  it('uses the same radius as the selected-node highlight', () => {
    const selected = ruleFor('.advmm-selected .markmap-foreign')
    expect(selected).toMatch(/border-radius:\s*var\(--radius-s\)/)
  })
})

describe('node highlight ring shape', () => {
  // A spreading `box-shadow` (`0 0 0 Npx`) on a node inside a scaled SVG
  // `foreignObject` escapes the clip and paints its outer corners as right
  // angles, so at high zoom the selected node's ring looks like a sharp blue
  // rectangle. An inset shadow hugs the rounded `border-radius` instead.
  it('draws the selected-node ring with an inset shadow (rounded when zoomed)', () => {
    const selected = ruleFor('.advmm-selected .markmap-foreign')
    expect(selected).toMatch(/box-shadow:\s*inset\s+0 0 0 2px/)
    expect(selected).not.toMatch(/box-shadow:\s*0 0 0 2px/)
  })

  // The drop-target and current-search highlights paint a solid fill, so their
  // outer `box-shadow` ring only adds square corners. They must not use one.
  it('avoids outer shadow rings on drop-target and current-search highlights', () => {
    expect(ruleFor('.advmm-drop-target .markmap-foreign')).not.toMatch(/box-shadow:\s*0 0 0/)
    expect(ruleFor('.advmm-search-current .markmap-foreign')).not.toMatch(/box-shadow:\s*0 0 0/)
  })
})

describe('inline node editor box', () => {
  // The editor sits exactly on the node while it is being edited, so a border or
  // padding would shrink its content box and make the text wrap (and clip)
  // differently from the node's. The ring is an inset shadow, which costs no
  // layout width.
  it('costs no layout width for its ring', () => {
    const editor = ruleFor('.advmm-node-editor')
    expect(editor).toMatch(/border:\s*none/)
    expect(editor).toMatch(/box-shadow:\s*inset\s+0 0 0 1px/)
  })

  it('shows the wrapped text without scrollbars or a resize handle', () => {
    const editor = ruleFor('.advmm-node-editor')
    expect(editor).toMatch(/resize:\s*none/)
    expect(editor).toMatch(/overflow:\s*hidden/)
  })
})

describe('canvas selection', () => {
  // Text selection must keep working: users copy node text with the mouse.
  it('keeps native text selection on the mindmap canvas', () => {
    expect(ruleFor('.markmap')).not.toMatch(/user-select:\s*none/)
  })
})

describe('rubber-band selection box', () => {
  it('rounds the marquee with a clearly visible radius', () => {
    expect(ruleFor('.advmm-marquee')).toMatch(/border-radius:\s*var\(--radius-l/)
  })
})
