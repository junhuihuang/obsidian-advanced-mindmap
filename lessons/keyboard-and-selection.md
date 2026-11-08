# Keyboard and selection

## After deleting a node, keep the focus nearby

**Do** select, in order: (1) the sibling that took the deleted position (the *next*
node), (2) if the deleted node was last, the previous sibling, (3) if it was an only
child, the parent, (4) only then clear the selection.

**Don't** call `selectOnly(null)` from `removePaths`: the user has to re-find and
re-click the node.

## Undo/redo must restore the cursor to the changed node

**Do** diff the two Markdown snapshots and infer the change kind from node counts:
`+1` = undo-delete, `-1` = undo-insert, equal = undo-rename. Then:

- **count increased**: prefer a genuinely new `path + text` pair; else a node whose text
  changed; else the shifted node.
- **count decreased**: walk both trees in parallel, stop at the first text mismatch — that
  is the removed node; focus its parent, or the sibling that replaced it.
- Always fall back to `afterFlat[0]`. Never `selectOnly(null)`.

**Don't**

- Treat a shifted node (path changed, text identical) as the new node — you focus the
  wrong one.
- Find the deleted node by set-differencing paths: later nodes shift up and fill the
  removed path, so the difference is empty or wrong.
- Call `undo()` while an inline input is still pending: the DOM swap blurs it and it
  saves against a stale path.

**Worked examples**

- `-a\n-c\n` → `-a\n-b\n-c\n`: 2 → 3 nodes, "increased" branch; path `[1]` text `c` → `b`
  differs → focus `[1]`.
- `-a\n  -New node\n-b\n` → `-a\n-b\n`: 3 → 2 nodes, "decreased" branch; parallel walk at
  `i=1` gives `New node ≠ b` → `removedIdx = 1` → removed path `[0,0]` → parent `[0]` →
  focus `a`.

## Pasted or dropped on the root, a node becomes top-level

**Symptom.** The user selected `I.`…`VII.` inside a lone list item, pressed `Ctrl+X`,
moved the cursor to the root and pressed `Ctrl+V`: nothing happened at all.

**Do**

- `childTargetPath([])` returns `[]` (not `null`), the empty path being the editor's
  word for "the document's top level". `pasteInto`, `dropPositionAt` and the paste
  button all go through it; do not re-check `primaryPath.length > 0` for paste.
- A drop onto the root means top level **wherever** in its box the pointer is: the root
  has no line to draw a sibling insertion against, so `before`/`after` cannot be
  expressed there. `resolveDropTarget` may therefore report the root for any position.
- `pasteInto` passes the **marked** paths to `moveEdits`, which collapses a nested
  selection itself — do not pre-filter, or the remove/insert edits drift from what
  `moveNodes` actually did.

**Don't** treat the empty path as "no destination": `getNodeAtPath` throws for it, so a
move must resolve it through `resolveMoveTarget` (`lessons/markdown-parsing.md`).

## `gd` (go to definition) jumps to the Markdown source line

**Wiring**

- `keymap.ts`: `GOTO_PREFIX = 'g'`.
- `node-editor.ts`: `handleGoToDefSequence()` for the prefix;
  `goToDefinition(path)` looks up the node's `SourceNode.line` via `sourceRoots()` and
  calls `goToSourceLine(line)`.
- `NodeEditorOptions.goToSourceLine?: (line: number) => void`, connected in
  `editor-wiring.ts` / `renderer-tab.ts` to `markdownSplit.goToLine(line)`.
- `markdown-split.ts`: `goToLine(line)` reuses the existing split or creates one, then
  positions the cursor with `setEphemeralState`.

**Details that matter**

- `SourceNode.line` is 0-based; add 1 for the editor.
- A **new** split needs `openFile` first, then `setTimeout(100ms)` before
  `setEphemeralState` — Obsidian's `MarkdownView` is not ready earlier. Reusing an
  existing split can apply the state immediately.

## Navigate the tree the canvas draws, not the source tree

**Symptom.** With the header's plain-text switch off, `h`/`l` did nothing between a
heading and its list items, and `j`/`k` jumped into a child level.

**Root cause.** A source path is not a rendered level. `# T` / prose / `- one` puts the
item at `[0, 0, 0]` (heading → paragraph → item), and any map that leaves the paragraph
out (e.g. a paragraph markmap itself dropped) draws the item one level below the
heading. `findNodeInDirection` used `path.length` as the level and `path.slice(0, -1)`
as the parent, so both pointed at the missing level.

The same holds for a node the canvas draws without a source path (markmap tags the
nodes it was able to map): the drawn tree, never the document, decides.

**Do** derive everything from `ordered` — the rendered paths in pre-order — in
`navigation.ts`:

- depth = the number of *drawn* ancestors (`renderedDepths`, a stack walk: a pre-order
  list keeps every ancestor on the stack when a path arrives);
- `left` = the closest preceding path one depth up (this also skips a level that is
  not tracked, e.g. a list markmap's `addChild` bug removed);
- `right` = `ordered[index + 1]` when it is a descendant, which is the rendered child.

**Do** take the "first child" from the drawn list, never from the path
(`[...path, 0]`). `revealFirstChild` (which `l` uses on a folded node) has to land on
a node the canvas draws: with plain text off the first source child is a paragraph.
It also has to drop the DOM index after the unfold (`invalidateIndex()`), because the
mutation observer that would notice the re-render runs a microtask later.

**Don't** assume `ordered.length` invariants the source tree: `visiblePaths()` filters a
source pre-order by what is drawn, and filtering a pre-order list still yields a
pre-order list.

**Search too.** A hit on a node the canvas does not draw selects nothing and leaves the
cursor invisible, so `runSearch` filters matches through `drawnDataPaths()` (markmap data,
so folded nodes still count). `revealSearchPath` walks that map by path instead of
`children[path[i]]`, which points at the wrong node once a level is skipped.

## A selection can outlive its node — re-anchor it after a structural render

**Symptom.** Turning the plain-text switch off while a paragraph was selected left the
cursor on nothing: no highlight, and every arrow key dead until the user clicked a node.

**Root cause.** `visiblePaths()` only holds drawn paths, so `findNodeInDirection` finds no
index for the stale path and returns `undefined`.

**Do**

- `nodeEditorHandle.dropVanishedSelection()` (`pruneVanishedSelection`) keeps the closest
  drawn ancestor as the cursor, and drops the caches (`dom`, `visibleCache`) the render
  invalidated.
- Call it from the renderer **only after a render it knows removed nodes**
  (`restructure` in `renderer-tab.ts`).

**Don't** prune inside the render microtask: the new-node flow selects the node it is
about to create *before* markmap draws it, so a prune there eats the fresh selection
(`node-editor-highlight-restore.test.ts`).
