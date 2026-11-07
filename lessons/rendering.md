# Rendering, folding, and layout

## Never render an edit with `markmap.setData()`

**Root cause.** `setData()` calls `_initializeData()`, which recomputes the fold state
of every node, so existing folds are lost and the DOM is rebuilt from scratch.

**Do**

- Edit on the live tree: `TreeUpdater` (`src/rendering/tree-updater.ts`) reconciles
  changes onto `markmap.state.data`, reusing existing `INode` objects (D3 key, DOM,
  `payload.fold`) and only touching changed content.
- Finish with `markmap.renderData()`. Never `setData()` / `_initializeData()`.
- Every edit operation (insert, setText, remove, move) must produce a `TreeEdit` and
  hand it to `treeUpdater`.

**Don't**

- Call `applyChange(next)` without the `edits` argument — the updater gets no edit
  info and silently falls back to a full `setData()` render.
- Use the "save folds → `setData()` → restore folds" workaround: high complexity and
  it still flickers.

## `shiftedPath` must handle `insert` *and* `remove`, on the accumulated path

**Root cause.** With several edits in one batch, each `TreeEdit` path is **relative to
the tree state when that edit happened**, not to the original tree.

**Do**

- Handle `insert` (index + 1) and `remove` (index - 1) in the same walk.
- Compare prefixes and indices using the **accumulated** current path, not the original.

```ts
// insert: this sibling position and everything after it moves +1
if (edit.type === 'insert' && path[depth] >= edit.path[depth]) path[depth]++
// remove: everything after it moves -1 (">", not ">=" — equal is the removed node)
if (edit.type === 'remove' && path[depth] > edit.path[depth]) path[depth]--
```

**Don't**

- Implement only `insert` → deletes fail to match → fall back to a full render.
- Compare against `original` instead of `path` → paths drift on the second edit.

## Express a node move as `remove` + `insert`

**Symptom.** Drag move, `J`/`K` reorder and cut-paste lost **all** fold state: they
called `applyChange(markdown)` with no edits and fell back to `setData()`.

**Do**

```ts
await applyChange(result.markdown, [
  { type: 'remove', path: source },
  { type: 'insert', path: dest },
])
```

- `reorderSelection` (`J`/`K`): `dest` is `targetPath`, already known.
- `moveTo` (drag) / `pasteInto`: recover `dest` from the result with
  `moveEdits(sourceRoots(), movedPaths, result)`, which maps every moved block
  (`MoveResult.lines`, one line per block) through `pathAtLine`.

**Batch ordering (multi-node `moveEdits`).** One batch can only be replayed in the
order that keeps every path valid:

- **removals back to front**, i.e. the later sibling first. `shiftedPath` decrements by
  comparing the *accumulated* index, so removing `[0,1]` before `[0,2]` leaves a node at
  `[0,3]` at `[0,2]` instead of `[0,1]`.
- **insertions in document order.** Consecutive appended siblings get the paths
  `k, k+1, …`; in that order each is already correct when its edit runs, and no later
  edit lowers an index that would shift it.
- Pass the **outermost** paths only. `moveNodes` collapses a nested selection onto its
  ancestor, so a `remove` edit for the descendant decrements the same survivors twice.

**Known-good.** `reconcile()` handles the "same path collision" of remove+insert
benignly: the moved node's old path and its neighbour's `shiftedPath` land on the same
key, `Map.set` lets the later write win, so the **neighbour** is reused (keeps its fold)
and the moved node is rebuilt (loses its own fold). That is the correct tree and
strictly better than `setData()`, which used to lose the neighbour's fold too. A `move`
edit type on `TreeEdit` would preserve both; it does not exist yet.

## Re-applying node classes after a render must use a microtask, not `requestAnimationFrame`

**Symptom.** Creating a node made `.advmm-selected` appear, flicker off, and come back.
Per-frame sampling: `t=9 sel=false`, `t=14 sel=true`, `t=126 sel=false`,
`t=142 sel=true`.

**Root cause (three layers).** (1) Incremental `renderData()` runs
`z.merge($).attr("class", …)`, rewriting the class of **every** node, not just the new
one. (2) Our `MutationObserver` re-applied the highlight inside `requestAnimationFrame`,
so restoring it cost a frame. (3) `markmap`'s constructor owns
`new ResizeObserver(debounce(() => this.renderData(), 100))`; measuring the new content
triggers a **second** `renderData()` ~100 ms later, wiping the class again.

**Do**

- Re-apply in `queueMicrotask`: MutationObserver callbacks are already batched
  microtasks, and the frame-merge that `rAF` provides is not needed here.
- Write only changed classes (`classList.contains(cls) === want` → skip), so our own
  writes produce an empty follow-up turn instead of a loop.
- **Every** per-node attribute belongs in that one pass, and the pass may not be
  gated on a selection: `applyHeadingLevels` (heading size/weight) runs before the
  `selectedPaths.length === 0` early return, or a freshly opened mindmap would
  show every heading at body size until the first click.

**Don't**

- Blame `fileChanged` (`editor-change` debounce 300 ms → `view.render`) for the second
  render: that one is already skipped by `treeUpdater.isCurrent` when content matches.

**Diagnosing.** Sample inside the page (a `rAF` loop reading the class), not by
round-tripping `Runtime.evaluate`.

## Recenter after fold/unfold with `markmap.fit()`, not `centerSubtree()`

**Symptom.** After `zc`/`zC`/`zo`/`zO`, the view jumped to a fixed 1.0x zoom around one
subtree, cropping the rest, and disagreed with the toolbar's "Fit window size".

**Do**

- `NodeEditorOptions.fitContent?: () => Promise<void>`, wired to `() => markmap.fit()`
  in `editor-wiring.ts`; `recenterAfterFold()` only calls `fitContent()`.
- `fit()` recomputes the whole-graph bounds (`state.rect`), derives scale from
  `fitRatio` and animates there. It only changes the transform, so it costs no layout.

**Keep** `centerSubtree()` for `Shift+M` (centre the selected node) — that is an
explicit "move me here" command, not "show the result of the change".

## `renderData()` does not await transitions

**Symptom.** Fold animations felt abrupt — nodes snapped into place.

**Root cause.** `markmap.renderData()` is `async` but awaits only a single
`requestAnimationFrame` (then `_relayout()`); the d3 transitions it creates are not
awaited, so the promise resolves immediately and `fitContent()` started a zoom
animation **while** the node transition was still running. Two 500 ms animations
overlapping reads as "instant and jumpy", not "smooth".

**Do**

- Delay the follow-up: `setTimeout(fitContent, getAnimationDuration())` in
  `recenterAfterFold()` (skip the timer entirely when the duration is ≤ 0 — testable,
  no pointless delay).
- If you truly need to wait, await `transition.end()`.

## Node width is per-node plugin data, never a global and never in the Markdown

`markmap-view`'s `maxWidth` is a **global** option exposed on `<svg>` as
`--markmap-max-width`; repurposing it to resize one node resizes all of them.

**Do**

- Store widths in the plugin's `data.json` as `nodeWidths[notePath][nodeKey]`. Users
  explicitly rejected `<!-- width: 1566 -->` in notes; `parseNodeParams` only ignores
  that legacy parameter.
- Key nodes by **FNV-1a hash of the node text**, plus an ordinal suffix for duplicate
  texts. Line numbers and path indices are wrong after any insert/move.
- `tagNodeWidthKeys()` runs during transform and writes the key to
  `payload.advmmWidthKey`; renderer and editor both look widths up through it.
- Apply the width to the **inner label** (`.markmap-foreign > div > div`) as
  `style.width`. `markmap`'s `_relayout()` measures the label's `scrollWidth`, so an
  inline width both widens short text and wraps long text at that width.
- `applyNodeWidths(svg, widths)` returns "did anything change"; when true, callers
  `await markmap.renderData()` — otherwise `fit()` computes the viewport from the old
  layout before the ResizeObserver's 100 ms debounce.
- Drag previews by writing the label width directly and commits on mouseup
  (`setNodeWidth(key, width)`); `Ctrl+Shift`+`+`/`-` commits on keyup. Reset is
  `setNodeWidth(key, null)` from the context menu, then re-apply + relayout.
- Hit-test only the selected node's right edge (6 px) so it cannot collide with
  drag-to-move; cursor `ew-resize`.
- Width is a **view preference**: not part of the note's undo history and not synced.
  That is the price of keeping the Markdown clean.

**Drag must keep up with the pointer**

1. On each `mousemove`, set the label `width`, then **synchronously** resize the
   `foreignObject` to `label.scrollWidth` / `label.scrollHeight` — no animation.
2. Then `markmap.renderData()` throttled by `rAF`, with `markmap.options.duration = 0`
   for the duration of the gesture (`beginLiveLayout` / `endLiveLayout`), so children,
   edges and fold circles follow within the frame instead of easing over 500 ms.
3. On release, restore the duration and write the width to the plugin data.

**Failure modes**

- `foreignObject` clips its content: if you only change the label width, wrapped lines
  are cut off when narrowing and the visible box lags far behind the cursor when
  widening. This — not the mouse handling — is why dragging "does not stick to the
  pointer".
- Calling `renderData()` during the drag with transitions on makes every size step a
  500 ms animation that chases the pointer.
- Editing the outer `foreignObject > div` does nothing: that is the `maxWidth`
  container; `markmap` measures the inner label.

## `z` + a single digit folds the whole map to that depth

**Do**

- `keymap.resolveFoldSequence`: `z` followed by one digit `0`–`9` →
  `{ action: 'foldToLevel', level: N }`. Single digit only, so `z1` applies
  immediately instead of waiting for a possible `z12`.
- `fold.foldToLevelPlan(root, level)` = `levelPlan(root, clamp(level, 0, treeDepth))`,
  sharing the `zC`/`zO` semantics ("level = depth of the shallowest collapsed parent"),
  so `z2` then `zC` continues to the next level seamlessly.
- `foldToLevel` always acts on the **whole tree** (unlike `zC`, which follows the
  selection): the user is asking "how many levels", independent of what is selected.
  `primaryNodeData()` already covers a selection that gets hidden.
- Three places must stay in sync when adding a fold action: keymap, `FOLD_HINTS`, and
  translations (`Record<FoldAction, …>` fails to compile otherwise), plus a line in the
  `?` help panel and the README — `help.test.ts` enforces the hint list.
