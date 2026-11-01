import { Platform } from 'obsidian'
import type { INode } from 'markmap-common'
import type { Markmap } from 'markmap-view'

/**
 * markmap folds/unfolds a node when its circle is clicked, through its own
 * `handleClick`. That handler only toggles; it never re-centers, so a circle
 * click leaves the view wherever the relayout put it.
 *
 * Replace the handler so a circle click toggles the node and then re-centers it
 * with `recenter` (the selected node's subtree, exactly like `Shift+M` and
 * `Shift`+`+`/`-`). Waiting for `toggleNode` to resolve means the recenter
 * uses the final layout rather than the pre-fold rectangles.
 */
export function recenterOnCircleClick(markmap: Markmap, recenter: (node: INode) => void): void {
  markmap.handleClick = (event: MouseEvent, node: INode) => {
    // Mirror markmap's own modifier handling: the platform modifier toggles the
    // whole subtree instead of a single node.
    const modifier = Platform.isMacOS ? event.metaKey : event.ctrlKey
    const recursive = modifier ? !markmap.options.toggleRecursively : markmap.options.toggleRecursively
    void markmap.toggleNode(node, recursive).then(() => recenter(node))
  }
}
