/**
 * Icons for the view header's actions.
 *
 * `ItemView.addAction()` can only draw Obsidian's (Lucide) icon set. The
 * markdown-source toggle keeps the glyph the old markmap toolbar used, so that
 * one is drawn by hand and swapped in after the action is created.
 */

/** Four left-aligned text lines, the last one short (markmap toolbar glyph). */
export const MARKDOWN_SOURCE_ICON_PATH = 'M4 4h12v1H4zM4 7h12v1H4zM4 10h12v1H4zM4 13h8v1H4z'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Replaces an action's icon with the toolbar's 20×20 glyph. The action keeps
 * its tooltip, `aria-label` and click handler; only its children are replaced.
 */
export function setMarkdownSourceIcon(action: HTMLElement) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('svg-icon', 'advmm-markdown-source-icon')
  // Lucide's `.svg-icon` rules are stroke-based; the toolbar glyph is filled.
  svg.style.fill = 'currentColor'
  svg.style.stroke = 'none'

  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', MARKDOWN_SOURCE_ICON_PATH)
  path.setAttribute('fill-rule', 'evenodd')
  svg.append(path)

  action.replaceChildren(svg)
}
