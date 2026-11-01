import type { EventRef, TFile, WorkspaceLeaf } from 'obsidian'

/**
 * Opens the note behind a mindmap in a native markdown split.
 *
 * The mindmap only shows the list/heading skeleton of a file, so anything else
 * (frontmatter, prose, callouts, code blocks) needs a real editor. Rather than
 * re-implementing one - or a preview - this hands the note to Obsidian itself:
 * the split is an ordinary `MarkdownView`, so live preview, reading view, every
 * editing command and every shortcut are exactly the ones the user already
 * knows. The mode is whatever the note was last opened in.
 */

/** The `app.workspace` members this module uses (so it can be tested). */
export interface MarkdownSplitWorkspace {
  createLeafBySplit: (leaf: WorkspaceLeaf, direction?: 'vertical' | 'horizontal', before?: boolean) => WorkspaceLeaf
  on: (name: 'layout-change', callback: () => void) => EventRef
  offref: (ref: EventRef) => void
}

export interface MarkdownSplitOptions {
  /** The leaf the mindmap itself lives in; the split opens next to it. */
  leaf: WorkspaceLeaf
  /** The note to show, or `undefined` while nothing is rendered. */
  getFile: () => TFile | undefined
  /** Called whenever the split opens or closes (to sync a toolbar button). */
  onChange?: (open: boolean) => void
  workspace: MarkdownSplitWorkspace
}

export interface MarkdownSplitHandle {
  /** Opens the note in a split, or closes the split if it already shows it. */
  toggle: () => Promise<void>
  /**
   * Opens the note at the given line (1-based). If the split is already open
   * it reuses it; otherwise creates one. The cursor is placed at the start of
   * the line and the editor scrolls to it.
   */
  goToLine: (line: number) => Promise<void>
  /** True while the split created by this handle is on screen. */
  isOpen: () => boolean
  destroy: () => void
}

export function createMarkdownSplit({ leaf, getFile, onChange, workspace }: MarkdownSplitOptions): MarkdownSplitHandle {
  let split: WorkspaceLeaf | null = null
  /**
   * False until `openFile` has resolved once. Creating the leaf already fires
   * `layout-change`, and at that point the new container is not in the document
   * yet - treating that as "the user closed it" would forget a split that is
   * still opening, and every later toggle would open yet another one.
   */
  let opened = false
  let destroyed = false

  function isOpen(): boolean {
    return split !== null && opened && split.view?.containerEl?.isConnected === true
  }

  /** Drops a split the user closed by hand, so the button stops looking active. */
  function forgetClosedSplit(): void {
    if (!split || !opened || isOpen()) return
    split = null
    opened = false
    onChange?.(false)
  }

  async function toggle(): Promise<void> {
    if (destroyed) return
    if (isOpen()) {
      split?.detach()
      split = null
      opened = false
      onChange?.(false)
      return
    }
    // Still opening: a second click must not create a second split.
    if (split && !opened) return

    const file = getFile()
    if (!file) return

    const created = workspace.createLeafBySplit(leaf, 'vertical')
    split = created
    await created.openFile(file, { active: true })
    opened = true
    onChange?.(true)
  }

  const layoutRef = workspace.on('layout-change', forgetClosedSplit)

  async function goToLine(line: number): Promise<void> {
    if (destroyed) return
    const file = getFile()
    if (!file) return

    // Convert the 0-indexed source line to a 0-indexed editor line.
    // `source-paths.ts` tracks lines from `parseSource` which omits
    // frontmatter and empty leading lines. The markdown in the file
    // may be offset by frontmatter, so we need to scan for the actual
    // content line. For now we pass the line as-is and let Obsidian
    // open at the given editor line.
    const editorLine = Math.max(0, line - 1)

    if (isOpen()) {
      // Reuse the existing split: set the cursor position.
      const view = split?.view
      if (view && typeof (view as any).setEphemeralState === 'function') {
        ;(view as any).setEphemeralState({
          line: editorLine,
          startLoc: { line: editorLine, col: 0, offset: 0 },
        })
      }
    } else {
      // Create a new split and open at the right line.
      if (split && !opened) return
      const created = workspace.createLeafBySplit(leaf, 'vertical')
      split = created
      await created.openFile(file, {
        active: true,
        state: { mode: 'source' },
      } as any)
      // Set the cursor position on the next tick; Obsidian's MarkdownView
      // needs to finish loading before it accepts ephemeral state.
      opened = true
      onChange?.(true)
      setTimeout(() => {
        const view = split?.view
        if (view && 'setEphemeralState' in view) {
          ;(view as any).setEphemeralState({
            line: editorLine,
            startLoc: { line: editorLine, col: 0, offset: 0 },
          })
        }
      }, 100)
    }
  }

  return {
    toggle,
    goToLine,
    isOpen,
    destroy() {
      destroyed = true
      workspace.offref(layoutRef)
    },
  }
}
