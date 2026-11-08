import { getApp } from 'src/core/app'
import { ITransformPlugin } from 'markmap-lib'
import { Component, EmbedInfo, MarkdownRenderer, parseLinktext, TFile } from 'obsidian'

import { getActiveFile } from 'src/views/get-active-file'
import MindmapView from 'src/views/view'
import views from 'src/views/views'


export const embedPlugin: ITransformPlugin = {
  name: 'advmm-embed',
  transform(hooks) {
    hooks.parser.tap(md => {
      md.inline.ruler.before('emphasis', 'advmm_embed', (state, silent) => {
        const { matched, length, linkText } = parseMain(state.src.slice(state.pos))
        if (!matched) return false
        if (silent) return true

        const token = state.push('advmm_embed', 'advmm-embed', 0)
        token.attrSet('linkText', linkText)

        state.pos += length
        return true
      })

      md.renderer.rules.advmm_embed = (tokens, idx) => {
        const token = tokens[idx]
        const attrs = (token.attrs || [])
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ')
        
        return `<advmm-embed ${attrs}></advmm-embed>`
      }
    })

    return {}
  }
}

function parseMain(str: string) {
  const match = 
    /^!\[\[(?<linkText>.+)]]/
      .exec(str)

  const linkText = match?.groups?.linkText
  if (!match || !linkText)
    return {
      matched: false as const
    }

  return {
    matched: true as const,
    length: match[0].length,
    linkText
  }
}


class EmbedElement extends HTMLElement {
  static observedAttributes = ['linkText']
  /**
   * Lifetime of the rendered markdown. It is tied to this element, which is
   * replaced by the render output right away, rather than to the plugin: a
   * component that lives as long as the app would keep every embed's handlers
   * alive.
   */
  private readonly component = new Component()

	async connectedCallback() {
    const linkText = this.getAttribute('linkText')
    if (!linkText) throw new Error('advmm-embed component must have a linkText attribute')

    const sourcePath = getSourcePath(this)

    this.component.load()
    await MarkdownRenderer.render(getApp(), `![[${linkText}]]`, this, sourcePath, this.component)

    // replace custom element with render output
    const embedContainer = this.children[0].children[0] as HTMLElement
    this.replaceWith(embedContainer)

    const src = embedContainer.getAttribute('src')!
    const { path, subpath } = parseLinktext(src)

    // `render()` loads the embed itself — unlike the deprecated
    // `renderMarkdown()`, which only produced an empty container. Keep the
    // container (the embed below needs its `src` and classes) but drop the
    // rendered children, otherwise the embed is rendered twice: two images in
    // one node, a note's content and title duplicated.
    embedContainer.empty()

    const file = getApp().metadataCache.getFirstLinkpathDest(path, sourcePath)
    if (!(file instanceof TFile)) {
      const el = createDiv('file-not-found')
      el.innerText = `File not found: ${path}`
      embedContainer.append(el)
      return
    }

    if (file.extension === 'md' && subpath === '') {
      const title = createDiv('embed-title markdown-embed-title')
      title.innerText = file.basename
      embedContainer.append(title)
    }

    const embedInfo: EmbedInfo = {
      app: getApp(),
      containerEl: embedContainer as HTMLDivElement,
      depth: 1,
      displayMode: false,
      linktext: src,
      showInline: false,
      sourcePath
    }
    const embedCreator = getApp().embedRegistry.embedByExtension[file.extension]
    const embedComponent = embedCreator(embedInfo, file, subpath)
    embedComponent.loadFile()
	}
}
const alreadyRegistered = !!customElements.get('advmm-embed')
if (!alreadyRegistered)
  customElements.define('advmm-embed', EmbedElement)

function getSourcePath(embedElement: EmbedElement) {
  const leafElement = embedElement.closest('.workspace-leaf')
  const view = Array.from(MindmapView.instances).find(view =>
      view.leaf.containerEl === leafElement)
  if (!view) throw new Error('Couldn\'t get view')
  const subject = views.get(view)
  if (!subject) throw new Error('Couldn\'t get subject')
  const file =
    subject !== 'unpinned'
    ? subject
    : getActiveFile()
  if (!file) throw new Error('Couldn\'t get file')

  return file.path
}
