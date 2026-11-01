// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { strings } from 'src/translation'
import { Menu } from 'src/test-utils/obsidian'

import { attachNodeEditor } from './node-editor'

// Obsidian augments the DOM with these helpers; provide a minimal version.
const proto = Element.prototype as any
proto.addClass = function (...classes: string[]) { this.classList.add(...classes) }
proto.removeClass = function (...classes: string[]) { this.classList.remove(...classes) }
proto.toggleClass = function (cls: string, on: boolean) { this.classList.toggle(cls, on) }
proto.createEl = function (tag: string, opts?: string | { cls?: string; text?: string }) {
  const el = document.createElement(tag)
  if (typeof opts === 'string') el.className = opts
  else {
    if (opts?.cls) el.className = opts.cls
    if (opts?.text) el.textContent = opts.text
  }
  this.append(el)
  return el
}
proto.createDiv = function (opts?: string | { cls?: string; text?: string }) {
  return this.createEl('div', opts)
}

const MARKDOWN = '- a\n- b\n- c\n'

function setup(markdown = MARKDOWN) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  // One rendered node per `- x` line, each with the visible box markmap draws.
  const boxes = ['a', 'b', 'c'].map((text, index) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'markmap-node')
    ;(group as unknown as { __data__: unknown }).__data__ = {
      content: text,
      children: [],
      payload: { advmmSourcePath: [index], advmmWidthKey: text },
    }

    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    foreignObject.setAttribute('class', 'markmap-foreign')
    const content = document.createElement('div')
    content.textContent = text
    foreignObject.append(content)
    group.append(foreignObject)
    svg.append(group)

    return content
  })

  const setMarkdown = vi.fn(() => Promise.resolve())
  const widths: Record<string, number> = {}
  const setNodeWidth = vi.fn((key: string, width: number | null) => {
    if (width === null) delete widths[key]
    else widths[key] = width
    return true
  })
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => markdown,
    setMarkdown,
    getNodeWidths: () => widths,
    setNodeWidth,
    getFoldRoot: () => ({ children: [] }),
  })

  return { boxes, setMarkdown, widths, setNodeWidth }
}

/** A left click on the node drawn at `box`, optionally extending the selection. */
function click(box: Element, init: MouseEventInit = {}) {
  box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
}

/** A right click on the node drawn at `box`, which is what opens the menu. */
function rightClick(box: Element): Menu {
  box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  return Menu.last!
}

/** Waits for the menu item's edit to reach the document. */
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('the node context menu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('removes every selected node when it is opened on one of them', async () => {
    const { boxes, setMarkdown } = setup()
    click(boxes[0])
    click(boxes[2], { shiftKey: true })

    rightClick(boxes[1]).click(strings.nodeEditor.remove)
    await settle()

    // The whole selection goes, exactly like pressing Backspace on it.
    expect(setMarkdown).toHaveBeenCalledWith('')
  })

  it('removes only the node it is opened on when that one is not selected', async () => {
    const { boxes, setMarkdown } = setup()
    click(boxes[0])
    click(boxes[1], { shiftKey: true })

    rightClick(boxes[2]).click(strings.nodeEditor.remove)
    await settle()

    expect(setMarkdown).toHaveBeenCalledWith('- a\n- b\n')
  })

  it('offers to reset the width of a resized node and forgets it', async () => {
    const { boxes, setMarkdown, widths, setNodeWidth } = setup()
    widths.b = 240

    click(boxes[1])
    rightClick(boxes[1]).click(strings.nodeEditor.resetWidth)
    await settle()

    expect(setNodeWidth).toHaveBeenCalledWith('b', null)
    expect(widths).toEqual({})
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('does not offer to reset the width of a normal node', () => {
    const { boxes } = setup()
    click(boxes[0])
    expect(rightClick(boxes[0]).item(strings.nodeEditor.resetWidth)).toBeUndefined()
  })

  it('ends the title of every shortcut item with its keys', () => {
    const { boxes } = setup()
    const menu = rightClick(boxes[0])
    const titles = menu.items.map(item => item.title)

    expect(titles).toContain(strings.nodeEditor.edit)
    expect(strings.nodeEditor.edit).toMatch(/\(i\)$/)
    expect(strings.nodeEditor.addChild).toMatch(/\(Tab\)$/)
    expect(strings.nodeEditor.addSibling).toMatch(/\(Enter\)$/)
    expect(strings.nodeEditor.cut).toMatch(/\(Ctrl\+X\)$/)
    expect(strings.nodeEditor.fold).toMatch(/\(zc\)$/)
    expect(strings.nodeEditor.unfold).toMatch(/\(zo\)$/)
    expect(strings.nodeEditor.unfoldAll).toMatch(/\(zO\)$/)
    expect(strings.nodeEditor.remove).toMatch(/\(Backspace\)$/)
  })

  it('puts Delete node last', () => {
    const { boxes, widths } = setup()
    // Every optional item is present, so the position really is the last one.
    widths.b = 240
    const menu = rightClick(boxes[1])

    expect(menu.items[menu.items.length - 1]?.title).toBe(strings.nodeEditor.remove)
  })

  it('removes the single selected node', async () => {
    const { boxes, setMarkdown } = setup()
    click(boxes[1])

    rightClick(boxes[1]).click(strings.nodeEditor.remove)
    await settle()

    expect(setMarkdown).toHaveBeenCalledWith('- a\n- c\n')
  })
})
