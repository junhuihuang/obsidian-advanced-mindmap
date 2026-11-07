// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachNodeEditor } from './node-editor'
import type { FoldNode, FoldPlan } from './fold'

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

function node(content: string, children: FoldNode[] = [], fold?: number): FoldNode {
  return { content, children, payload: fold === undefined ? {} : { fold } } as FoldNode & { content: string }
}

/** Contents of the nodes in a plan, so assertions do not depend on identity. */
function contents(nodes: FoldNode[]): string[] {
  return nodes.map(node => (node as unknown as { content: string }).content)
}

function setup(root: FoldNode, select = false, selectedChildren: FoldNode[] = []) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.append(svg)
  document.body.append(container)

  // One selectable node whose source path points at the `- leaf` line below.
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content: 'leaf',
    children: selectedChildren,
    payload: { advmmSourcePath: [0] },
  }
  svg.append(group)

  const applyFoldPlan = vi.fn((plan: FoldPlan) => {
    // Mirror the real renderer: apply the plan so repeated commands progress.
    for (const node of plan.fold) node.payload = { ...node.payload, fold: 1 }
    for (const node of plan.unfold) node.payload = { ...node.payload, fold: 0 }
  })
  const centerNode = vi.fn()
  const fitContent = vi.fn()
  attachNodeEditor({
    svg: svg as unknown as SVGSVGElement,
    getMarkdown: () => '- leaf\n',
    setMarkdown: () => {},
    getFoldRoot: () => root,
    applyFoldPlan,
    centerNode,
    fitContent,
    getAnimationDuration: () => 0,
  })

  const press = (key: string, init: KeyboardEventInit = {}) => {
    container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  }

  if (select) press('ArrowDown')

  return { press, applyFoldPlan, centerNode, fitContent, container, group }
}

/** `root` → (`a` → `a1`), a tree of depth 2. */
function sample(): FoldNode {
  return node('root', [node('a', [node('a1')])])
}

describe('whole-tree fold commands', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('folds the whole tree on zc when nothing is selected', () => {
    const { press, applyFoldPlan } = setup(sample())
    press('z')
    press('c')
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })

  it('unfolds the whole tree on zo when nothing is selected', () => {
    const { press, applyFoldPlan } = setup(node('root', [node('a')], 1))
    press('z')
    press('o')
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })

  it('fully expands the whole tree on zO when nothing is selected', () => {
    const { press, applyFoldPlan } = setup(node('root', [node('a', [node('a1')])], 1))
    press('z')
    press('O', { shiftKey: true })
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })

  it('toggles everything on zA', () => {
    const { press, applyFoldPlan } = setup(sample())
    press('z')
    press('A')
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })

  it('shows exactly two levels on z2', () => {
    const { press, applyFoldPlan } = setup(node('root', [node('a', [node('a1', [node('a1x')])])]))
    press('z')
    press('2')
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
    // Level 2 keeps the root and `a` open and folds everything at depth 2.
    expect(contents((applyFoldPlan.mock.calls[0][0] as FoldPlan).fold)).toEqual(['a1'])
  })

  it('treats z digits as document-wide even with a node selected', () => {
    const child = node('sub', [node('sub1', [node('sub2')])])
    const { press, applyFoldPlan } = setup(sample(), true, [child])
    press('z')
    press('1')
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
    // The plan is rooted at the document, not at the selection.
    expect(contents((applyFoldPlan.mock.calls[0][0] as FoldPlan).fold)).toEqual(['a'])
  })

  it('collapses to the root on z0', () => {
    const { press, applyFoldPlan } = setup(sample())
    press('z')
    press('0')
    expect(contents((applyFoldPlan.mock.calls[0][0] as FoldPlan).fold)).toEqual(['root', 'a'])
  })

  it('does nothing on a z digit that already matches the visible level', () => {
    const root = sample()
    for (const node of root.children ?? []) node.payload = { ...node.payload, fold: 1 }
    const { press, applyFoldPlan } = setup(root)
    press('z')
    press('1')
    expect(applyFoldPlan).not.toHaveBeenCalled()
  })

  it('folds only the selected node on zc', () => {
    const { press, applyFoldPlan } = setup(sample(), true)
    press('z')
    press('c')
    expect(applyFoldPlan).not.toHaveBeenCalled()
  })

  it('folds the whole tree one level on zC when nothing is selected', () => {
    const { press, applyFoldPlan } = setup(node('root', [node('a', [node('a1')])], 1))
    press('z')
    press('C', { shiftKey: true })
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
    expect((applyFoldPlan.mock.calls[0][0] as FoldPlan).unfold).toHaveLength(0)
  })

  // `zC` is the mirror image of `zo`: one level of the selected node's subtree,
  // or of the whole tree (i.e. the root's subtree) when nothing is selected.
  it('folds one level of the selected subtree on zC', () => {
    const child = node('sub', [node('sub1')])
    const { press, applyFoldPlan } = setup(sample(), true, [child])
    press('z')
    press('C', { shiftKey: true })
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
    const plan = applyFoldPlan.mock.calls[0][0] as FoldPlan
    // The plan is rooted at the selection, not at the tree root.
    expect(plan.fold).toEqual([child])
    expect(plan.unfold).toHaveLength(0)
  })

  it('folds a deeper level of the selected subtree on a second zC', async () => {
    const child = node('sub', [node('sub1', [node('sub2')])])
    const { press, applyFoldPlan } = setup(sample(), true, [child])
    press('z')
    press('C', { shiftKey: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((applyFoldPlan.mock.calls[0][0] as FoldPlan).fold).toEqual([child.children![0]])

    press('z')
    press('C', { shiftKey: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(applyFoldPlan).toHaveBeenCalledTimes(2)
    expect((applyFoldPlan.mock.calls[1][0] as FoldPlan).fold).toEqual([child])
  })

  it('survives a Shift keydown before the second key', () => {
    const { press, applyFoldPlan } = setup(sample())
    press('z')
    press('Shift', { shiftKey: true })
    press('A', { shiftKey: true })
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })

  it('shows the key hint after z and keeps it open on Shift', () => {
    const { press, container } = setup(sample())
    press('z')
    const hint = container.querySelector('.advmm-key-hint') as HTMLElement
    expect(hint.classList.contains('advmm-hidden')).toBe(false)
    expect(Array.from(hint.querySelectorAll('kbd')).map(k => k.textContent)).toEqual(['c', 'C', 'o', 'O', 'a', '0…9'])

    press('Shift', { shiftKey: true })
    expect(hint.classList.contains('advmm-hidden')).toBe(false)
  })

  it('hides the hint on Escape', () => {
    const { press, container } = setup(sample())
    press('z')
    const hint = container.querySelector('.advmm-key-hint') as HTMLElement
    press('Escape')
    expect(hint.classList.contains('advmm-hidden')).toBe(true)
  })
})

describe('selected-node unfold commands', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setupSelected(folded = true) {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const grandData = { content: 'grand', children: [] as unknown[], payload: {} as { fold?: number } }
    const childData = { content: 'child', children: [grandData], payload: {} as { fold?: number } }
    const parentData = {
      content: 'leaf',
      children: [childData],
      payload: { advmmSourcePath: [0], ...(folded ? { fold: 1 } : {}) },
    }
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'markmap-node')
    ;(group as unknown as { __data__: unknown }).__data__ = parentData
    svg.append(group)

    // Mirror the real renderer: apply the plan so repeated `zo` can progress.
    const applyFoldPlan = vi.fn((plan: FoldPlan) => {
      for (const node of plan.fold) node.payload = { ...node.payload, fold: 1 }
      for (const node of plan.unfold) node.payload = { ...node.payload, fold: 0 }
    })
    const toggleFold = vi.fn()
    const revealChildren = vi.fn()
    const revealAllChildren = vi.fn()
    const centerNode = vi.fn()
    const fitContent = vi.fn()

    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => '- leaf\n  - child\n    - grand\n',
      setMarkdown: () => {},
      getFoldRoot: () => parentData as unknown as FoldNode,
      applyFoldPlan,
      toggleFold,
      revealChildren,
      revealAllChildren,
      centerNode,
      fitContent,
      getAnimationDuration: () => 0,
    })

    const press = (key: string, init: KeyboardEventInit = {}) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    }
    press('ArrowDown')
    return { press, applyFoldPlan, toggleFold, revealChildren, revealAllChildren, centerNode, fitContent, parentData, childData, grandData }
  }

  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('unfolds only one level of the selected node on zo', async () => {
    const { press, applyFoldPlan, toggleFold, revealChildren, revealAllChildren, parentData, childData } = setupSelected()
    press('z')
    press('o')
    await flush()
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
    expect(revealChildren).not.toHaveBeenCalled()
    expect(revealAllChildren).not.toHaveBeenCalled()
    expect(toggleFold).not.toHaveBeenCalled()
    // The parent opens; its child stays folded so the grandchild stays hidden.
    expect(parentData.payload.fold).toBe(0)
    expect(childData.payload.fold).toBe(1)
  })

  it('walks one level deeper on each zo', async () => {
    const { press, applyFoldPlan, parentData, childData, grandData } = setupSelected()

    press('z')
    press('o')
    await flush()
    expect(parentData.payload.fold).toBe(0)
    expect(childData.payload.fold).toBe(1)

    press('z')
    press('o')
    await flush()
    expect(childData.payload.fold).toBe(0)
    expect(grandData.payload.fold).toBeFalsy()
    expect(applyFoldPlan).toHaveBeenCalledTimes(2)

    // Fully expanded now: a third `zo` has nothing left to reveal.
    press('z')
    press('o')
    await flush()
    expect(applyFoldPlan).toHaveBeenCalledTimes(2)
  })

  it('unfolds every descendant of the selected node on zO', async () => {
    const { press, applyFoldPlan, toggleFold, revealChildren, revealAllChildren } = setupSelected()
    press('z')
    press('O', { shiftKey: true })
    await flush()
    expect(revealAllChildren).toHaveBeenCalledTimes(1)
    expect(revealChildren).not.toHaveBeenCalled()
    expect(toggleFold).not.toHaveBeenCalled()
    expect(applyFoldPlan).not.toHaveBeenCalled()
  })

  it('does nothing on zo when the subtree is already fully expanded', async () => {
    const { press, applyFoldPlan, revealChildren } = setupSelected(false)
    press('z')
    press('o')
    await flush()
    expect(revealChildren).not.toHaveBeenCalled()
    expect(applyFoldPlan).not.toHaveBeenCalled()
  })

  it('still unfolds every descendant on zO when the node is already open', async () => {
    const { press, revealAllChildren } = setupSelected(false)
    press('z')
    press('O', { shiftKey: true })
    await flush()
    expect(revealAllChildren).toHaveBeenCalledTimes(1)
  })

  it('folds the selected node on zc', async () => {
    const { press, toggleFold, revealChildren } = setupSelected(false)
    press('z')
    press('c')
    await flush()
    expect(toggleFold).toHaveBeenCalledTimes(1)
    expect(revealChildren).not.toHaveBeenCalled()
  })

  // A fold/unfold re-fits the viewport so the full extent of the changed mindmap
  // stays visible, like the toolbar "Fit window size" button.
  it('re-fits the viewport after zc folds the selected node', async () => {
    const { press, fitContent } = setupSelected(false)
    press('z')
    press('c')
    await flush()
    expect(fitContent).toHaveBeenCalledTimes(1)
  })

  it('re-fits the viewport after zo reveals one level', async () => {
    const { press, fitContent } = setupSelected()
    press('z')
    press('o')
    await flush()
    expect(fitContent).toHaveBeenCalledTimes(1)
  })

  it('re-fits the viewport after zO reveals the subtree', async () => {
    const { press, fitContent } = setupSelected()
    press('z')
    press('O', { shiftKey: true })
    await flush()
    expect(fitContent).toHaveBeenCalledTimes(1)
  })
})

describe('centering the whole tree after a fold / unfold', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  // With nothing selected a whole-tree command acts on every node, so the
  // viewport is re-fit to show the full extent of the changed tree.
  it('re-fits the viewport after a whole-tree zc', async () => {
    const root = sample()
    const { press, fitContent } = setup(root)
    press('z')
    press('c')
    await flush()
    expect(fitContent).toHaveBeenCalledTimes(1)
  })

  it('re-fits the viewport after a whole-tree zo', async () => {
    const root = node('root', [node('a')], 1)
    const { press, fitContent } = setup(root)
    press('z')
    press('o')
    await flush()
    expect(fitContent).toHaveBeenCalledTimes(1)
  })

  it('re-fits the viewport after a whole-tree zO', async () => {
    const root = node('root', [node('a', [node('a1')])], 1)
    const { press, fitContent } = setup(root)
    press('z')
    press('O', { shiftKey: true })
    await flush()
    expect(fitContent).toHaveBeenCalledTimes(1)
  })
})

describe('Escape', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('clears the selection', () => {
    const { press, group } = setup(sample(), true)
    expect(group.classList.contains('advmm-selected')).toBe(true)

    press('Escape')
    expect(group.classList.contains('advmm-selected')).toBe(false)
  })
})

describe('l on a folded node', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setupFolded(withChildren: boolean) {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const markdown = withChildren ? '- leaf\n  - child\n    - grand\n' : '- leaf\n'
    const childData: { content: string; children: Array<{ content: string; payload: Record<string, unknown> }>; payload: Record<string, unknown> } = {
      content: 'child',
      children: [{ content: 'grand', payload: {} }],
      payload: {},
    }
    const parentData = {
      content: 'leaf',
      children: withChildren ? [childData] : [],
      payload: { advmmSourcePath: [0], fold: 1 },
    }
    const parent = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    parent.setAttribute('class', 'markmap-node')
    ;(parent as unknown as { __data__: unknown }).__data__ = parentData
    svg.append(parent)

    let childGroup: SVGGElement | null = null
    const toggleFold = vi.fn()
    const revealChildren = vi.fn((node: unknown) => {
      const data = node as { payload: { fold?: number }; children: Array<{ payload: { fold?: number } }> }
      data.payload.fold = 0
      for (const child of data.children) child.payload.fold = 1
      childGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      childGroup.setAttribute('class', 'markmap-node')
      ;(childGroup as unknown as { __data__: unknown }).__data__ = {
        content: 'child',
        children: [],
        payload: { advmmSourcePath: [0, 0] },
      }
      svg.append(childGroup)
    })

    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => markdown,
      setMarkdown: () => {},
      getFoldRoot: () => parentData as unknown as FoldNode,
      applyFoldPlan: vi.fn(),
      toggleFold,
      revealChildren,
    })

    const press = (key: string, init: KeyboardEventInit = {}) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    }

    press('ArrowDown')
    return { press, toggleFold, revealChildren, childData, getChild: () => childGroup }
  }

  it('reveals one level via revealChildren and selects the first child', async () => {
    const { press, toggleFold, revealChildren, childData, getChild } = setupFolded(true)
    press('l')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(revealChildren).toHaveBeenCalledTimes(1)
    expect(toggleFold).not.toHaveBeenCalled()
    expect(getChild()?.classList.contains('advmm-selected')).toBe(true)
    // Only one level is revealed: the child stays folded so its child stays hidden.
    expect(childData.payload.fold).toBe(1)
  })

  it('does nothing for a leaf node', async () => {
    const { press, toggleFold, revealChildren, getChild } = setupFolded(false)
    press('l')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(revealChildren).not.toHaveBeenCalled()
    expect(toggleFold).not.toHaveBeenCalled()
    expect(getChild()).toBeNull()
  })
})

describe('highlight across re-renders', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('restores the selection after markmap overwrites the class attribute', async () => {
    const { group } = setup(sample(), true)
    expect(group.classList.contains('advmm-selected')).toBe(true)

    // markmap.renderData() sets `class` to "markmap-node", wiping our class.
    group.setAttribute('class', 'markmap-node')
    expect(group.classList.contains('advmm-selected')).toBe(false)

    // The MutationObserver must re-apply it on the next animation frame.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(group.classList.contains('advmm-selected')).toBe(true)
  })
})

describe('whole-tree commands when the selection is hidden', () => {
  afterEach(() => { document.body.innerHTML = '' })

  /**
   * A single selectable node plus a folded tree root. `applyFoldPlan` removes
   * the group from the DOM — as markmap does when folding hides a node — so the
   * selection ends up pointing at a node that is no longer rendered.
   */
  function setupHidden() {
    document.body.innerHTML = ''
    const container = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.append(svg)
    document.body.append(container)

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'markmap-node')
    ;(group as unknown as { __data__: unknown }).__data__ = {
      content: 'leaf',
      children: [],
      payload: { advmmSourcePath: [0] },
    }
    svg.append(group)

    const applyFoldPlan = vi.fn(() => { group.remove() })
    attachNodeEditor({
      svg: svg as unknown as SVGSVGElement,
      getMarkdown: () => '- root\n  - leaf\n',
      setMarkdown: () => {},
      // Folded root one level deep, so `zo`/`zO` have something to unfold.
      getFoldRoot: () => node('root', [node('leaf')], 1),
      applyFoldPlan,
    })

    const press = (key: string, init: KeyboardEventInit = {}) => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    }

    press('ArrowDown')      // select the node
    press('z')
    press('a')              // collapse: the selected node becomes hidden
    applyFoldPlan.mockClear()

    return { press, applyFoldPlan }
  }

  it('still unfolds the whole tree on zo', () => {
    const { press, applyFoldPlan } = setupHidden()
    press('z')
    press('o')
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })

  it('still fully expands the whole tree on zO', () => {
    const { press, applyFoldPlan } = setupHidden()
    press('z')
    press('O', { shiftKey: true })
    expect(applyFoldPlan).toHaveBeenCalledTimes(1)
  })
})
