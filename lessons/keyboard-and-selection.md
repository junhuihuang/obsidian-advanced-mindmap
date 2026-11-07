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
