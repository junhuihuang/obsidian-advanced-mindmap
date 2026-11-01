// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import { parseSource } from './source-tree'
import type { SourceNode } from './source-tree'

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

let editor: { destroy: () => void } | null = null

function nodeGroup(svg: SVGSVGElement, path: number[], lines: string, left = 0) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content: 'a',
    children: [],
    payload: { advmmSourcePath: path, lines },
  }

  // markmap's visible box: foreignObject > div > div, which we can measure.
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  fo.setAttribute('class', 'markmap-foreign')
  const outer = document.createElement('div')
  const content = document.createElement('div')
  content.getBoundingClientRect = () => ({ left, top: 0, width: 50, height: 20 }) as DOMRect
  outer.append(content)
  fo.append(outer)
  group.append(fo)

  svg.append(group)
  return group
}

/**
 * The write hangs forever, so anything that appears must not have waited for it.
 */
function setup() {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  nodeGroup(svg, [0], '0,1')

  const onSourceChange = vi.fn()
  const setMarkdown = vi.fn((_markdown: string) => new Promise<void>(() => {}))
  editor = attachNodeEditor({
    getMarkdown: () => '- a\n',
    onSourceChange,
    setMarkdown,
    svg: svg as unknown as SVGSVGElement,
    getFoldRoot: () => ({ children: [] }),
    applyFoldPlan: () => {},
  })

  const press = (key: string) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }
  const input = () => document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement | null

  return { press, input, setMarkdown, onSourceChange, svg }
}

describe('adding nodes', () => {
  afterEach(() => {
    editor?.destroy()
    editor = null
    document.body.innerHTML = ''
  })

  it('opens the editor for a new sibling without waiting for the write', () => {
    const { press, input, setMarkdown, onSourceChange } = setup()

    press('ArrowDown')   // select `[0]`
    press('Enter')       // add a sibling

    // The inline editor is already there even though `setMarkdown` never resolves.
    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('- a\n- New node\n')
    expect(onSourceChange).toHaveBeenCalledWith('- a\n', '- a\n- New node\n', [{ type: 'insert', path: [1] }])
  })

  it('opens the editor for a new child while editing (Tab)', () => {
    const { press, input, setMarkdown, onSourceChange } = setup()

    press('ArrowDown')
    press('i')            // start editing `[0]`
    const first = input()!
    first.value = 'a2'
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    // The second editor replaces the first immediately.
    expect(document.querySelectorAll('textarea.advmm-node-editor')).toHaveLength(1)
    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('- a2\n  - New node\n')
    expect(onSourceChange).toHaveBeenCalledWith('- a\n', '- a2\n  - New node\n', [
      { type: 'setText', path: [0] }, { type: 'insert', path: [0, 0] },
    ])
  })

  it('adds a child without writing when the text was only cleared', () => {
    const { press, input, setMarkdown } = setup()

    press('ArrowDown')
    press('i')
    const first = input()!
    first.value = '   '
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    // The empty edit is dropped, but the child is still added in one write.
    expect(setMarkdown).toHaveBeenCalledTimes(1)
    expect(setMarkdown.mock.calls[0][0]).not.toContain('   ')
    expect(input()?.value).toBe('New node')
  })

  it('sits over the anchor until the new node is actually rendered', () => {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    // `[1]` currently owns source line 1. Adding a sibling to `[0]` will reuse
    // that line for the new node, so the stale `[1]` must not be mistaken for it.
    nodeGroup(svg, [0], '0,1', 100)
    nodeGroup(svg, [1], '1,2', 999)

    editor = attachNodeEditor({
      getMarkdown: () => '- a\n- b\n',
      setMarkdown: vi.fn((_markdown: string) => new Promise<void>(() => {})),
      svg: svg as unknown as SVGSVGElement,
      getFoldRoot: () => ({ children: [] }),
      applyFoldPlan: () => {},
    })

    const press = (key: string) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    press('ArrowDown')  // select `[0]`
    press('Enter')      // add a sibling

    // The stale `[1]` (left = 999) is ignored: the input stays on the anchor.
    const input = document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement
    expect(input.style.left).toBe('100px')
  })

  /**
   * A document whose markmap root is synthetic (source path `[]`): prose only
   * or a flat list. `Tab` on it must still add a node.
   */
  function setupRoot(markdown: string, selectRoot = true) {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const rootGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    rootGroup.setAttribute('class', 'markmap-node')
    ;(rootGroup as unknown as { __data__: unknown }).__data__ = {
      content: '对外界面',
      children: [] as never[],
      payload: { advmmSourcePath: [] },
    }
    svg.append(rootGroup)

    const setMarkdown = vi.fn((_md: string) => new Promise<void>(() => {}))
    editor = attachNodeEditor({
      getMarkdown: () => markdown,
      setMarkdown,
      svg: svg as unknown as SVGSVGElement,
      getFoldRoot: () => ({ children: [] }),
      applyFoldPlan: () => {},
    })

    // Click the synthetic root to select it.
    if (selectRoot) rootGroup.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const press = (key: string) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    const input = () => document.querySelector('textarea.advmm-node-editor') as HTMLTextAreaElement | null
    return { press, input, setMarkdown, rootGroup }
  }

  it('appends a top-level node on Tab for a document with no nodes of its own', () => {
    // `> note` is prose: the title shown as the root comes from the renderer, and
    // Tab must still add the note's first node.
    const { press, input, setMarkdown } = setupRoot('> note\n')
    press('Tab')

    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('> note\n- New node\n')
  })

  it('bootstraps an empty document', () => {
    const { press, input, setMarkdown } = setupRoot('')
    press('Tab')

    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('- New node\n')
  })

  it('appends a sibling of the last top-level node on Tab', () => {
    const { press, input, setMarkdown } = setupRoot('- a\n- b\n')
    press('Tab')

    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('- a\n- b\n- New node\n')
  })

  it('adds a top-level node on Tab even before anything is selected', () => {
    // Opened straight from the command (e.g. Ctrl+Shift+M): nothing is selected
    // yet, but Tab must still add a node instead of moving Obsidian's focus.
    const { press, input, setMarkdown } = setupRoot('> note\n', false)
    press('Tab')

    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('> note\n- New node\n')
  })

  it('appends a sibling of the last node on Tab with nothing selected', () => {
    const { press, input, setMarkdown } = setupRoot('- a\n- b\n', false)
    press('Tab')

    expect(input()?.value).toBe('New node')
    expect(setMarkdown).toHaveBeenCalledWith('- a\n- b\n- New node\n')
  })

  it('still refuses to edit, remove or un-sibling the synthetic root', () => {
    const { press, input, setMarkdown } = setupRoot('> note\n')

    press('i')        // edit the root's text
    press('Enter')    // sibling of the root
    press('Delete')   // remove the root

    expect(input()).toBeNull()
    expect(setMarkdown).not.toHaveBeenCalled()
  })

  it('never writes a title into the document', () => {
    // The title is a render-only node (see `root-title.ts`): adding the first
    // node must not put the file name into the note.
    const { press, setMarkdown } = setupRoot('> note\n')
    press('Tab')

    expect(setMarkdown.mock.calls[0][0]).not.toContain('对外界面')
  })
})

describe('removing nodes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function setupRemove(markdown: string) {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const groupFor = (data: any) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.setAttribute('class', 'markmap-node')
      ;(group as unknown as { __data__: unknown }).__data__ = data
      group.append(document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject'))
      svg.append(group)
      return group
    }

    const render = () => {
      svg.replaceChildren()
      const parsed = parseSource(md)
      const walk = (nodes: SourceNode[], parentPath: number[]) => {
        let idx = 0
        for (const node of nodes) {
          const path = [...parentPath, idx++]
          const data = { content: node.text, children: [], payload: { advmmSourcePath: path } }
          groupFor(data)
          if (node.children.length > 0) {
            walk(node.children, path)
          }
        }
      }
      walk(parsed, [])
    }

    let md = markdown
    render()

    const handle = attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => md,
      setMarkdown: async next => { md = next; render() },
      getFoldRoot: () => ({
        content: '',
        children: Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
          .map(g => (g as any).__data__ as any),
        payload: { fold: 0, advmmSourcePath: [] },
      }),
    })

    const press = (key: string) => container.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    const selected = () => Array.from(svg.querySelectorAll<SVGGElement>('g.advmm-selected'))
      .map(g => (g as any).__data__.content)

    const select = (content: string) => {
      const el = Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
        .find(g => (g as any).__data__.content === content)!
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }

    return { press, select, selected, handle, container, svg, md: () => md }
  }

  it('places focus on the next sibling after deleting a node', async () => {
    const { select, press, selected, handle, md } = setupRemove('- a\n- b\n- c\n')

    select('b')
    press('Delete')
    // Let the microtask queue drain so the async removePaths completes.
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(md()).toBe('- a\n- c\n')
    expect(selected()).toEqual(['c'])
    handle.destroy()
  })

  it('places focus on the previous sibling when the last child is deleted', async () => {
    const { select, press, selected, handle, md } = setupRemove('- a\n- b\n- c\n')

    select('c')
    press('Delete')
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(md()).toBe('- a\n- b\n')
    expect(selected()).toEqual(['b'])
    handle.destroy()
  })

  it('places focus on the parent after deleting the only child', async () => {
    const { select, press, selected, handle, md } = setupRemove('- a\n  - a1\n')

    select('a1')
    press('Delete')
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(md()).toBe('- a\n')
    expect(selected()).toEqual(['a'])
    handle.destroy()
  })

  it('selects nothing after deleting the root (handled gracefully)', async () => {
    const { select, press, selected, handle, md } = setupRemove('- root\n')

    select('root')
    press('Delete')
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(md()).toBe('')
    expect(selected()).toEqual([])
    handle.destroy()
  })
})

describe('undo/redo focus', () => {
  function setupUndo(markdown: string) {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const groupFor = (data: any) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.setAttribute('class', 'markmap-node')
      ;(group as unknown as { __data__: unknown }).__data__ = data
      group.append(document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject'))
      svg.append(group)
      return group
    }

    const render = () => {
      svg.replaceChildren()
      const parsed = parseSource(md)
      const walk = (nodes: SourceNode[], parentPath: number[]) => {
        let idx = 0
        for (const node of nodes) {
          const path = [...parentPath, idx++]
          const data = { content: node.text, children: [], payload: { advmmSourcePath: path } }
          groupFor(data)
          if (node.children.length > 0) walk(node.children, path)
        }
      }
      walk(parsed, [])
    }

    let md = markdown
    render()

    const handle = attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => md,
      setMarkdown: async next => { md = next; render() },
      getFoldRoot: () => ({
        content: '',
        children: Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
          .map(g => (g as any).__data__ as any),
        payload: { fold: 0, advmmSourcePath: [] },
      }),
    })

    const press = (key: string, ctrl = false) => container.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true }))
    const selected = () => Array.from(svg.querySelectorAll<SVGGElement>('g.advmm-selected'))
      .map(g => (g as any).__data__.content)
    const select = (content: string) => {
      const el = Array.from(svg.querySelectorAll<SVGGElement>('g.markmap-node'))
        .find(g => (g as any).__data__.content === content)!
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }

    return { press, select, selected, handle, svg, md: () => md }
  }

  it('undo after delete focuses the restored node', async () => {
    const { select, press, selected, handle, md } = setupUndo('- a\n- b\n- c\n')

    select('b')
    press('Delete')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n- c\n')

    press('z', true)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n- b\n- c\n')
    expect(selected()).toEqual(['b'])
    handle.destroy()
  })

  it('undo after inserting child focuses the parent', async () => {
    const { select, press, selected, handle, md } = setupUndo('- a\n- b\n')

    select('a')
    press('Tab')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n  - New node\n- b\n')

    // Commit the inline editor so undoing doesn't leave a stale textarea.
    const input = document.querySelector<HTMLTextAreaElement>('textarea.advmm-node-editor')
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }

    press('z', true)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n- b\n')
    expect(selected()).toEqual(['a'])
    handle.destroy()
  })

  it('redo after undo restores the forward state and focuses the changed node', async () => {
    const { select, press, selected, handle, md } = setupUndo('- a\n- b\n- c\n')

    select('b')
    press('Delete')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n- c\n')

    press('z', true) // undo
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n- b\n- c\n')
    expect(selected()).toEqual(['b'])

    press('u', true) // redo (Ctrl+U)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(md()).toBe('- a\n- c\n')
    expect(selected()).toEqual(['c'])
    handle.destroy()
  })
})
