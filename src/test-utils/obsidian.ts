/**
 * Minimal `obsidian` stubs for unit tests. Only the members used by the modules
 * under test are implemented; the real Obsidian API is provided by the host app
 * at runtime and is not importable in a test environment.
 */

/** A menu item the code under test added, so a test can click it. */
export class MenuItem {
  title = ''
  icon = ''
  click: (() => void) | null = null

  setTitle(title: string): this { this.title = title; return this }
  setIcon(icon: string): this { this.icon = icon; return this }
  onClick(callback: () => void): this { this.click = callback; return this }
}

export class Menu {
  /** The menu opened last: the one a test is about to click. */
  static last: Menu | null = null

  /** Items in the order the code added them. */
  readonly items: MenuItem[] = []

  constructor() { Menu.last = this }

  addItem(callback: (item: MenuItem) => unknown): this {
    const item = new MenuItem()
    callback(item)
    this.items.push(item)
    return this
  }

  addSeparator(): this { return this }

  /** The item titled `title`, or `undefined`. */
  item(title: string): MenuItem | undefined {
    return this.items.find(item => item.title === title)
  }

  /** Runs what the item titled `title` does. */
  click(title: string): void {
    const item = this.item(title)
    if (!item) throw new Error(`No menu item titled "${title}"`)
    item.click?.()
  }

  showAtMouseEvent(): void {}
  showAtPosition(): void {}
  hide(): void {}
}

export class Notice {
  constructor(_message?: string, _timeout?: number) {}
}

export const Platform = {
  isMobile: false,
  isMobileApp: false,
  isDesktop: true,
  isDesktopApp: true,
  isMacOS: false,
}

export function setIcon(_el: HTMLElement, _icon: string): void {}

export function setTooltip(el: HTMLElement, tooltip: string, _options?: unknown): void {
  el.setAttribute('aria-label', tooltip)
}

export function getLanguage(): string { return 'en' }

export function getFrontMatterInfo(content: string): {
  exists: boolean
  frontmatter: string
  contentStart: number
} {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content)
  if (!match) return { exists: false, frontmatter: '', contentStart: 0 }
  return { exists: true, frontmatter: match[0], contentStart: match[0].length }
}
