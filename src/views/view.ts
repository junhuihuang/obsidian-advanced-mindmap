import { ItemView, Menu, WorkspaceLeaf } from 'obsidian'

import { MM_VIEW_TYPE } from 'src/constants'
import { TabRenderer } from 'src/rendering/renderer-tab'
import { strings } from 'src/translation'
import Callbag from 'src/utilities/callbag'
import { setMarkdownSourceIcon } from './action-icons'


export default class MindmapView extends ItemView {
  private displayText: string
  private pinned: boolean
  
  private renderer: TabRenderer
  public render: TabRenderer['render']
  public firstRender: TabRenderer['firstRender']
  public focus: TabRenderer['focus']
  public destroy: TabRenderer['destroy']

  public static instances = new Set<MindmapView>()

  constructor(public leaf: WorkspaceLeaf, displayText: string, pinned: boolean) {
    super(leaf)
    MindmapView.instances.add(this)
    this.register(() =>
      MindmapView.instances.delete(this))

    this.displayText = displayText
    this.pinned = pinned

    this.renderer = TabRenderer(this.containerEl, this.leaf)
    this.render = this.renderer.render
    this.firstRender = this.renderer.firstRender
    this.focus = this.renderer.focus
    this.destroy = this.renderer.destroy
    this.register(() => this.destroy())

    this.addViewActions()

    // Re-focus the editor when the user switches back to this tab, so the
    // keyboard shortcuts keep working without an extra click.
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf === this.leaf) this.focus()
    }))
  }

  private static togglePinnedSubject = Callbag.subject<MindmapView>()
  public static togglePinned$ = this.togglePinnedSubject.source
  private togglePinned() {
    MindmapView.togglePinnedSubject.push(this)
  }

  /**
   * The mindmap controls live in the view header, left of Obsidian's own
   * "More options" button, exactly like the actions of a markdown view.
   * `ItemView.addAction()` prepends, so they are added right-to-left.
   */
  private addViewActions() {
    const { zoomIn, zoomOut, fit, toggleMarkdownSource, onMarkdownSourceChange } = this.renderer

    const markdownSource = this.addAction('file-code-2', strings.markdownSource.button, toggleMarkdownSource)
    // Keep the glyph the old markmap toolbar used for this button.
    setMarkdownSourceIcon(markdownSource)
    this.addAction('maximize', strings.viewActions.fit, fit)
    // A per-canvas switch: a deep map fits far more nodes when its headings are
    // drawn at body size. Added after `fit` because actions are prepended.
    const headingStyles = this.addAction('heading', strings.viewActions.headingStyles, () => {
      headingStyles.classList.toggle('is-active', this.renderer.toggleHeadingStyles())
    })
    headingStyles.classList.add('is-active')
    this.addAction('zoom-out', strings.viewActions.zoomOut, zoomOut)
    this.addAction('zoom-in', strings.viewActions.zoomIn, zoomIn)

    onMarkdownSourceChange(open => markdownSource.classList.toggle('is-active', open))
  }

  public getViewType() { return MM_VIEW_TYPE }
  public getDisplayText() { return this.displayText }
  public getIcon() { return 'dot-network' }

  public setDisplayText(displayText: string) {
    this.displayText = displayText
    this.leaf.updateHeader()
  }

  public onPaneMenu(menu: Menu, source: string) {
    const { collapseAll, takeScreenshot } = this.renderer
    menu
      .addItem(item => item
        .setIcon('pin')
        .setTitle(this.pinned ? strings.menu.pin.unpin : strings.menu.pin.pin)
        .onClick(() => this.togglePinned())
      )
      .addItem(item => item
        .setIcon('image-file')
        .setTitle(strings.menu.copyScreenshot)
        .onClick(takeScreenshot)
      )
      .addItem(item => item
        .setIcon('folder')
        .setTitle(strings.menu.collapseAll)
        .onClick(collapseAll)
      )

    super.onPaneMenu(menu, source)
  }
}
