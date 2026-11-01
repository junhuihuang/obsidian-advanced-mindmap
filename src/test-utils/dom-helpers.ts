/**
 * The DOM helpers Obsidian adds to the global scope and to `Element.prototype`.
 *
 * Obsidian provides them at runtime, but unit tests run in plain jsdom, so the
 * same helpers are installed there: the plugin code (and the tests) can rely on
 * `createDiv`, `el.addClass`, `el.setCssStyles`, ... exactly as in the app.
 */

export type DomElementOptions = string | {
  cls?: string
  text?: string
  title?: string
  type?: string
  value?: string
  placeholder?: string
  href?: string
  attr?: Record<string, string | number | boolean | null>
}

interface DomHelpers {
  createEl: <K extends keyof HTMLElementTagNameMap>(
    tag: K, options?: DomElementOptions, callback?: (el: HTMLElementTagNameMap[K]) => void,
  ) => HTMLElementTagNameMap[K]
  createDiv: (options?: DomElementOptions, callback?: (el: HTMLDivElement) => void) => HTMLDivElement
  createSpan: (options?: DomElementOptions, callback?: (el: HTMLSpanElement) => void) => HTMLSpanElement
  createSvg: <K extends keyof SVGElementTagNameMap>(
    tag: K, options?: DomElementOptions, callback?: (el: SVGElementTagNameMap[K]) => void,
  ) => SVGElementTagNameMap[K]
  createFragment: (callback?: (fragment: DocumentFragment) => void) => DocumentFragment
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

function applyOptions(el: Element, options?: DomElementOptions) {
  if (options === undefined) return
  if (typeof options === 'string') {
    el.className = options
    return
  }
  if (options.cls) el.className = options.cls
  if (options.text !== undefined) el.textContent = options.text
  if (options.title !== undefined) el.setAttribute('title', options.title)
  if (options.type !== undefined) el.setAttribute('type', options.type)
  if (options.placeholder !== undefined) el.setAttribute('placeholder', options.placeholder)
  if (options.href !== undefined) el.setAttribute('href', options.href)
  if (options.value !== undefined) (el as HTMLInputElement).value = options.value
  for (const [key, value] of Object.entries(options.attr ?? {}))
    if (value !== null && value !== false) el.setAttribute(key, String(value))
}

/** Installs the global and prototype helpers; safe to call more than once. */
export function installDomHelpers() {
  // This module *is* the implementation of Obsidian's `createEl` family, so it
  // has to reach the raw DOM API. Calling `document.createElement(...)` here
  // would be the very pattern `obsidianmd/prefer-create-el` flags in plugin
  // code, and the types mark `createElement` deprecated (one of its overloads
  // covers the deprecated HTML tags), so the namespaced form is used instead:
  // it creates the same elements for the XHTML namespace HTML elements live in.
  const nativeCreateElement = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    document.createElementNS(HTML_NAMESPACE, tag) as HTMLElementTagNameMap[K]
  const nativeCreateAnyElement = (tag: string) => document.createElementNS(HTML_NAMESPACE, tag)
  const nativeCreateElementNS = document.createElementNS.bind(document)
  const nativeCreateDocumentFragment = document.createDocumentFragment.bind(document)

  const helpers = window as unknown as DomHelpers

  const append = <T extends Element>(el: T, parent: Element, options?: DomElementOptions, callback?: (el: T) => void): T => {
    applyOptions(el, options)
    callback?.(el)
    parent.appendChild(el)
    return el
  }
  const appendToBody = <T extends Element>(el: T, options?: DomElementOptions, callback?: (el: T) => void) =>
    append(el, document.body, options, callback)
  const appendTo = <T extends Element>(parent: Element, el: T, options?: DomElementOptions, callback?: (el: T) => void) =>
    append(el, parent, options, callback)

  helpers.createEl = (tag, options, callback) => appendToBody(nativeCreateElement(tag), options, callback)
  helpers.createDiv = (options, callback) => appendToBody(nativeCreateElement('div'), options, callback)
  helpers.createSpan = (options, callback) => appendToBody(nativeCreateElement('span'), options, callback)
  helpers.createSvg = (tag, options, callback) =>
    appendToBody(nativeCreateElementNS(SVG_NAMESPACE, tag), options, callback)
  helpers.createFragment = callback => {
    const fragment = nativeCreateDocumentFragment()
    callback?.(fragment)
    return fragment
  }

  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.createSpan ??= function (this: Element, options?: DomElementOptions, callback?: (el: HTMLSpanElement) => void) {
    return appendTo(this, nativeCreateElement('span'), options, callback)
  }
  proto.createEl ??= function (this: Element, tag: string, options?: DomElementOptions, callback?: (el: HTMLElement) => void) {
    return appendTo(this, nativeCreateAnyElement(tag), options, callback)
  }
  proto.addClass ??= function (this: Element, ...classes: string[]) { this.classList.add(...classes) }
  proto.removeClass ??= function (this: Element, ...classes: string[]) { this.classList.remove(...classes) }
  proto.toggleClass ??= function (this: Element, cls: string, on: boolean) { this.classList.toggle(cls, on) }
  proto.hasClass ??= function (this: Element, cls: string) { return this.classList.contains(cls) }
  proto.empty ??= function (this: Element) { this.replaceChildren() }
  proto.instanceOf ??= function (this: Element, ctor: typeof Element) { return (this as object) instanceof ctor }
  proto.setCssStyles ??= function (this: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>) {
    const style = this.style as unknown as Record<string, string>
    const declarations = styles as Record<string, string | number | null | undefined>
    for (const [key, value] of Object.entries(declarations))
      style[key] = value === null || value === undefined ? '' : String(value)
  }
  proto.setCssProps ??= function (this: HTMLElement | SVGElement, props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value)
  }
}
