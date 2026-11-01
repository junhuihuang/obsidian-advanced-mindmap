import { samePath } from './source-tree'
import type { DropTarget } from './drop-target'

/** Square of the distance the pointer must travel to start a drag (5px). */
export const DRAG_THRESHOLD_SQUARED = 25

export function findNodeGroup(target: EventTarget | null): SVGGElement | null {
  if (!(target instanceof Element)) return null
  const foreign = target.closest('.markmap-foreign')
  if (!foreign) return null
  return foreign.closest('g.markmap-node') as SVGGElement | null
}

/** Like `findNodeGroup` but also matches the fold circles. */
export function findAnyNodeGroup(target: EventTarget | null): SVGGElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('g.markmap-node') as SVGGElement | null
}

export function sameDropTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.position === b.position && samePath(a.path, b.path)
}

export function isTextInput(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (element.isContentEditable) return true
  const editable = element.getAttribute?.('contenteditable')
  if (editable && editable !== 'false') return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/**
 * Drops any native text selection so a leftover selection does not look like
 * a selected node highlight with wrong corners (especially at high zoom).
 */
export function clearNativeSelection(doc: Document | undefined) {
  if (typeof doc?.getSelection !== 'function') return
  if (isTextInput(doc.activeElement)) return
  doc.getSelection()?.removeAllRanges()
}

/** Elements that own their own tap behaviour (links, fold circles). */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target instanceof SVGCircleElement || !!target.closest('a')
}
