import { loadJS, loadCSS, INode } from 'markmap-common'
import { builtInPlugins, IFeatures, Transformer } from 'markmap-lib'
import { deriveOptions, globalCSS, IMarkmapOptions, Markmap } from 'markmap-view'
import { zoomIdentity, zoomTransform } from 'd3-zoom'
import { centerZoom, clampToViewport, zoomAround, zoomWheelDelta, type ZoomAnchor, type ZoomRect } from './zoom'
import { renderedNodeRect, renderedTreeCenter } from './rendered-geometry'
import { CodeBlockSettings, FileSettings } from 'src/settings/filesystem'
import * as yaml from 'yaml'
import { parseInternalLinks } from 'src/internal-links/parse-internal-links'
import { nodeParams } from 'src/node-params/node-params'
import { tagNodeWidthKeys } from './node-widths'
import { tagHeadingLevels } from './node-headings'
import { embedPlugin } from 'src/embeds/embeds'
import { nextTick } from 'src/utilities/utilities'
import { getFrontMatterInfo } from 'obsidian'
import type { FoldNode, FoldPlan } from 'src/editing/fold'
import { revealAll, revealOneLevel } from 'src/editing/fold'
import { parseSource, type SourceNode } from 'src/editing/source-tree'
import { tagSourcePaths } from 'src/editing/source-paths'
import { dropEmptyWrappers, insertProseNodes } from './prose-nodes'


const styleEl = createEl('style', {
  parent: document.head,
  text: globalCSS
})
void nextTick().then(() => {
  const sheet = new Stylesheet(styleEl)
  const rule = sheet.getRule('.markmap')!
  rule.removeProperty('color')
  rule.removeProperty('font')
})


export const transformer = new Transformer([ ...builtInPlugins, embedPlugin ])

/** Picks the given keys from an object, returning a new object with only those keys. */
function pick<T extends object, K extends keyof T>(keys: K[], obj: T): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) result[key] = obj[key]
  return result
}

/**
 * `prose: false` leaves plain paragraphs out of the tree, so a map only shows
 * headings, lists, tables and code blocks. `structuralOnly` keeps the paragraph
 * that introduces one of those (the line before a `1.` / `-` list): it is not
 * plain text, and the block would lose its context without it. Both are set by
 * `proseTransformOptions`, one per `ProseMode`.
 */
export interface TransformOptions {
  prose?: boolean
  structuralOnly?: boolean
}

export function transformMarkdown(
  markdown: string,
  sourceRoots: SourceNode[] = parseSource(markdown),
  { prose = true, structuralOnly = false }: TransformOptions = {},
) {
  const { root, features } = transformer.transform(markdown)
  loadAssets(features)
  tagSourcePaths(root, sourceRoots)
  // `structuralOnly` inserts just the paragraphs that introduce a list, a table
  // or a code block; with `prose: false` the rest is left out and anything markmap
  // wrapped for a dropped paragraph is flattened, or the canvas would draw an
  // empty node (`dropEmptyWrappers`).
  insertProseNodes(root, sourceRoots, text => transformer.md.renderInline(text), { structuralOnly: structuralOnly || !prose })
  if (!prose) dropEmptyWrappers(root)
  parseInternalLinks(root)
  nodeParams(root)
  tagNodeWidthKeys(root, sourceRoots)
  tagHeadingLevels(root, sourceRoots)
  return root
}

export function splitMarkdown<Type extends 'file' | 'codeBlock'>(type: Type, markdown: string) {
  const { frontmatter, contentStart } = getFrontMatterInfo(markdown)
  const body = markdown.slice(0, contentStart)
  const parsed: unknown = yaml.parse(frontmatter) ?? {}
  type Settings =
    Type extends 'file' ? FileSettings : CodeBlockSettings
  const markmap = isRecord(parsed) ? parsed.markmap : undefined
  const settings = (isRecord(markmap) ? markmap : {}) as Settings
  return { body, settings }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function loadAssets(features: IFeatures) {
  const { styles, scripts } = transformer.getUsedAssets(features)
  if (scripts) void loadJS(scripts)
  if (styles) void loadCSS(styles.filter(style => {
    const href = (style.data as { href?: string } | undefined)?.href
    // Highlight.js's theme is replaced by the plugin's own node coloring.
    return !href?.includes('@highlightjs')
  }))
}

function withNodeColor(fn: (node: INode) => string) {
  return (node: INode) => (node.payload?.nodeColor as string | undefined) ?? fn(node)
}

export function getOptions(settings: CodeBlockSettings): Partial<IMarkmapOptions> {
  const { color: branchColoring } = deriveOptions(pick(['color', 'colorFreezeLevel'], settings))
  const colorFn = {
    branch: branchColoring ? withNodeColor(branchColoring) : undefined,
    depth: withNodeColor(depthColoring(settings)),
    single: withNodeColor(() => settings.defaultColor)
  }[settings.coloring]

  return {
    autoFit: false,
    fitRatio: 1,
    duration: settings.animationDuration,
    // Pan with the touchpad/two-finger scroll on every platform. Without this
    // markmap only pans on macOS and zooms on Linux/Windows. Pinch (or
    // Ctrl+scroll) still zooms.
    scrollForPan: true,
    ...pick([
      'initialExpandLevel',
      'maxWidth',
      'nodeMinHeight',
      'paddingX',
      'spacingVertical',
      'spacingHorizontal',
    ], settings),
    ...colorFn && { color: colorFn }
  }
}

export function depthColoring(settings: CodeBlockSettings) {
  return ({ state: { depth } }: INode) => {
    if (settings.color?.length)
      return settings.color[depth % settings.color.length]

    const colors = [settings.depth1Color, settings.depth2Color, settings.depth3Color]

    return depth <= 3
      ? colors[depth - 1]
      : settings.defaultColor
  }
}


/**
 * Applies the fold changes computed by the whole-tree commands (`zC`/`zO`/`zA`)
 * and re-renders once. Payloads are spread so unrelated fields (e.g. the source
 * path) survive.
 */
export function applyFoldPlan(markmap: Markmap, plan: FoldPlan): Promise<void> {
  const setFold = (node: FoldNode, fold: boolean) => {
    node.payload = { ...node.payload, fold: fold ? 1 : 0 }
  }

  for (const node of plan.fold) setFold(node, true)
  for (const node of plan.unfold) setFold(node, false)
  return markmap.renderData()
}

/**
 * Reveals exactly one level of `node`'s subtree (unfolds it, folds its
 * children so grandchildren stay hidden). Returns the re-render promise so
 * callers can act once the layout is final.
 */
export function unfoldOneLevel(markmap: Markmap, node: INode): Promise<void> {
  revealOneLevel(node)
  return markmap.renderData()
}

/**
 * Reveals every descendant of `node` (unfolds the whole subtree). Returns the
 * re-render promise so callers can act once the layout is final.
 */
export function unfoldAllLevels(markmap: Markmap, node: INode): Promise<void> {
  revealAll(node)
  return markmap.renderData()
}

/**
 * Applies `factor` to the mindmap's zoom immediately (no transition, so a
 * held key can drive it every animation frame). The `anchor` content point is
 * moved to the center of the viewport; when it is omitted the center of the
 * whole content is used instead, so zooming always grows/shrinks around the
 * middle of the canvas. When `keepVisible` is given (the selected node's box)
 * the result is nudged so that node never leaves the viewport, however far the
 * user zooms in.
 */
export function zoomMarkmap(markmap: Markmap, factor: number, anchor?: ZoomAnchor, keepVisible?: ZoomRect): void {
  const svgNode = markmap.svg.node()
  if (!svgNode) return

  const current = zoomTransform(svgNode)
  const box = svgNode.getBoundingClientRect()
  const point = anchor ?? contentZoomAnchor(markmap)

  if (!point) {
    // Nothing to center on (empty mindmap): keep the viewport center fixed.
    const next = zoomAround(
      { k: current.k, x: current.x, y: current.y },
      factor,
      (box.width / 2 - current.x) / current.k,
      (box.height / 2 - current.y) / current.k,
    )
    markmap.svg.call(boundTransform(markmap), zoomIdentity.translate(next.x, next.y).scale(next.k))
    return
  }

  let next = centerZoom({ k: current.k, x: current.x, y: current.y }, factor, point, box.width, box.height)
  if (keepVisible) next = clampToViewport(next, keepVisible, box.width, box.height)
  markmap.svg.call(boundTransform(markmap), zoomIdentity.translate(next.x, next.y).scale(next.k))
}

/**
 * Pans the view (keeping the current scale) so that the center of `node`'s
 * subtree lands in the middle of the canvas, then clamps so the node itself
 * stays on screen. This mirrors the keyboard zoom placement, so `Shift+M` and
 * `Shift`+`+`/`-` agree: the node sits left of center and its descendants fill
 * the rest of the screen.
 */
export function centerSubtree(markmap: Markmap, node: INode): Promise<void> {
  const svgNode = markmap.svg.node()
  const anchor = zoomAnchor(markmap, node)
  const keepVisible = zoomRect(markmap, node)
  if (!svgNode || !anchor) return Promise.resolve()

  const current = zoomTransform(svgNode)
  const box = svgNode.getBoundingClientRect()
  let next = centerZoom({ k: current.k, x: current.x, y: current.y }, 1, anchor, box.width, box.height)
  if (keepVisible) next = clampToViewport(next, keepVisible, box.width, box.height)
  const target = zoomIdentity.translate(next.x, next.y).scale(next.k)

  return markmap.transition(markmap.svg).call(boundTransform(markmap), target).end().catch(() => {})
}

/**
 * d3-zoom's `transform` is a method of the zoom behaviour, so it has to keep
 * its receiver when it is handed to `selection.call`.
 */
function boundTransform(markmap: Markmap) {
  return markmap.zoom.transform.bind(markmap.zoom)
}

/**
 * The content-space center of a node's whole subtree, used as the zoom anchor
 * for that node. Because a mindmap grows left to right, this sits to the right
 * of the node, so zooming parks the node left of the canvas center and lets its
 * descendants fill the rest of the screen.
 */
export function zoomAnchor(markmap: Markmap, node: INode): ZoomAnchor | undefined {
  return renderedTreeCenter(markmap, node)
}

/** The content-space box of a single rendered node, used to keep it on screen. */
export function zoomRect(markmap: Markmap, node: INode): ZoomRect | undefined {
  return renderedNodeRect(markmap, node)
}


/**
 * The content-space center of the whole rendered mindmap, used as the zoom
 * anchor when nothing is selected.
 */
export function contentZoomAnchor(markmap: Markmap): ZoomAnchor | undefined {
  return markmap.state.data ? renderedTreeCenter(markmap, markmap.state.data) : undefined
}


export function createMarkmap({ parent }: { parent: ParentNode }): { svg: SVGSVGElement, markmap: Markmap } {
  const svg = createSvg('svg')
  const markmap = Markmap.create(svg, { embedGlobalCSS: false })
  // Tame Ctrl+wheel: d3-zoom's 10x ctrl boost is meant for trackpad pinch, but
  // makes a mouse-wheel notch jump ~4x. See ./zoom.
  markmap.zoom.wheelDelta(zoomWheelDelta)
  // Allow right-button drag to pan. d3-zoom (and markmap) reserve the right
  // button for the context menu; we keep that menu but suppress it after a real
  // drag in the node editor.
  const baseFilter = markmap.zoom.filter() as unknown as (event: MouseEvent) => boolean
  markmap.zoom.filter((event: MouseEvent) =>
    event.type === 'mousedown' && event.button === 2 ? !event.ctrlKey : baseFilter(event))
  parent.append(svg)
  // Preview-style heading sizes (see ./node-headings and `styles.css`). Always
  // on; the view's header button removes the class to flatten one canvas,
  // without touching the note, the settings or the other mindmaps.
  svg.classList.add('advmm-heading-styles')

  return { svg, markmap }
}

class Stylesheet {
  private sheet: CSSStyleSheet
  private rules: CSSRule[]
  constructor(styleElement: HTMLStyleElement) {
    this.sheet = styleElement.sheet!
    this.rules = Array.from(this.sheet.cssRules)
  }

  getRule(selector: string) {
    const rule = this.rules.find(rule =>
      rule instanceof CSSStyleRule &&
      rule.selectorText === selector
    ) as CSSStyleRule | undefined

    return rule && new Rule(rule)
  }
}

class Rule {
  constructor(private cssRule: CSSStyleRule) {}

  removeProperty(name: string) {
    this.cssRule.style.removeProperty(name)
  }
}
