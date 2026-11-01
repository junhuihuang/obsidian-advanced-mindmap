/**
 * Shared harness for the editing performance tests and benchmarks.
 *
 * Building a mindmap large enough to measure means building the markdown, the
 * source tree and the rendered DOM from the same data, and counting how much
 * work the editor does per keystroke. Both the regression test
 * (`editing/node-editor-perf.test.ts`) and the benchmarks
 * (`editing/perf.bench.ts`) need exactly that, so it lives here.
 */
import type { NodeEditorHandle, NodeEditorOptions } from 'src/editing/node-editor'

import { attachNodeEditor } from 'src/editing/node-editor'
import { flattenPaths, parseSource, type SourceNode } from 'src/editing/source-tree'

import { installDomHelpers } from './dom-helpers'

installDomHelpers()

/**
 * A markdown document with about `4 * n` nodes: one heading, then flat list
 * items with three children each. Deep enough for path lookups to matter, wide
 * enough for scans over every node to show up.
 */
export function largeDocument(n: number): string {
  const lines = ['# Root']
  for (let i = 0; i < n; i++) {
    lines.push(`- item ${i}`, `  - child ${i}.0`, `  - child ${i}.1`, `  - child ${i}.2`)
  }
  return `${lines.join('\n')}\n`
}

/** Container of the most recently created harness, for cleanup. */
let lastContainer: HTMLElement | null = null

export interface PerfHarness {
  svg: SVGSVGElement
  container: HTMLElement
  editor: NodeEditorHandle
  /** Every rendered node, in the order the tree was walked. */
  groups: SVGGElement[]
  /** Paths of every rendered node. */
  paths: number[][]
  /** Number of `svg.querySelectorAll` calls since the last reset. */
  queries: () => number
  resetQueries: () => void
  /** Clicks the node at `path`, as a user would. */
  select: (path: number[]) => void
  /** Presses a key on the editor container. */
  press: (key: string) => void
  /** The inline editor, if one is open. */
  input: () => HTMLTextAreaElement | null
  /** The markdown last handed to `setMarkdown`. */
  written: () => string | null
  /** A node in the middle of the tree, with children to scroll past. */
  middlePath: () => number[]
  destroy: () => void
}

/**
 * Renders `markdown` into a jsdom SVG and attaches the editor, with every node
 * present (a fully expanded mindmap: the worst case for a scan over the DOM).
 *
 * `setMarkdown` keeps the edited markdown but never resolves, mirroring the
 * harness the unit tests use: the write is asynchronous, so anything the editor
 * does before it resolves is what the user waits for.
 */
export function createPerfHarness(markdown: string, options: Partial<NodeEditorOptions> = {}): PerfHarness {
  // Only the container of the previous harness goes: anything else in the
  // document (an inline editor another harness is still measuring) stays put.
  lastContainer?.remove()
  const container = createDiv()
  const svg = createSvg('svg')
  container.append(svg)
  document.body.append(container)
  lastContainer = container

  const paths: number[][] = []
  const groups: SVGGElement[] = []
  const byPath = new Map<string, SVGGElement>()
  const byLine = new Map<number, SVGGElement>()

  const add = (nodes: SourceNode[], prefix: number[]) => {
    nodes.forEach((node, index) => {
      const path = [...prefix, index]
      const group = nodeGroup(path, node.line, node.endLine)
      svg.append(group)
      paths.push(path)
      groups.push(group)
      byPath.set(path.join('.'), group)
      byLine.set(node.line, group)
      add(node.children, path)
    })
  }
  add(parseSource(markdown), [])

  let queryCount = 0
  const querySelectorAll = svg.querySelectorAll.bind(svg)
  svg.querySelectorAll = (selectors: string) => {
    queryCount++
    return querySelectorAll(selectors)
  }

  let current = markdown

  const editor = attachNodeEditor({
    getMarkdown: () => current,
    setMarkdown: next => { current = next },
    svg,
    getFoldRoot: () => ({ children: [] }),
    applyFoldPlan: () => {},
    ...options,
  })

  const ordered = flattenPaths(parseSource(markdown))
  const middle = ordered[Math.floor(ordered.length / 2)]

  return {
    svg,
    container,
    editor,
    groups,
    paths,
    queries: () => queryCount,
    resetQueries: () => { queryCount = 0 },
    select: path => {
      const group = byPath.get(path.join('.'))!
      group.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    },
    press: key => container.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    input: () => document.querySelector<HTMLTextAreaElement>('textarea.advmm-node-editor'),
    written: () => current === markdown ? null : current,
    middlePath: () => middle,
    destroy: () => {
      editor.destroy()
      document.querySelectorAll('textarea.advmm-node-editor').forEach(element => element.remove())
    },
  }
}

/** One `g.markmap-node`, with the payload markmap gives it. */
function nodeGroup(path: number[], line: number, endLine: number): SVGGElement {
  const group = createSvg('g')
  group.setAttribute('class', 'markmap-node')
  ;(group as unknown as { __data__: unknown }).__data__ = {
    content: 'x',
    children: [],
    payload: { advmmSourcePath: path, lines: `${line},${endLine}` },
  }

  // markmap's visible box: foreignObject > div > div, which the editor measures.
  const foreignObject = createSvg('foreignObject')
  foreignObject.setAttribute('class', 'markmap-foreign')
  const outer = createDiv()
  const content = createDiv()
  content.getBoundingClientRect = () => ({ left: 10, top: 10, width: 50, height: 20 }) as DOMRect
  outer.append(content)
  foreignObject.append(outer)
  group.append(foreignObject)
  return group
}

/** Mean milliseconds per call of `fn`, after one warm-up call. */
export function timeAverage(fn: () => void, repetitions = 20): number {
  fn()
  const start = performance.now()
  for (let i = 0; i < repetitions; i++) fn()
  return (performance.now() - start) / repetitions
}
