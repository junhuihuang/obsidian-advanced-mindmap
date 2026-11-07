# LESSONS.md

Index of what recent merged work got wrong, and the rule that would have caught it.
Each rule lives in one topic file; read only the ones your change touches.

| Topic | File | Read it when you touch |
| --- | --- | --- |
| Rendering, folding, layout | [lessons/rendering.md](lessons/rendering.md) | tree updates, fold/unfold, viewport fit, node width, `TreeUpdater`, `markmap.*` |
| Inline editing | [lessons/inline-editing.md](lessons/inline-editing.md) | `src/editing/inline-input.ts`, editor geometry, new-node flow |
| Keyboard and selection | [lessons/keyboard-and-selection.md](lessons/keyboard-and-selection.md) | keymap, `node-editor.ts` actions, undo/redo, delete, `gd` |
| Obsidian host integration | [lessons/obsidian-host.md](lessons/obsidian-host.md) | leaves, splits, layout persistence, editor/preview, focus, hotkeys |
| Markdown parsing and node mapping | [lessons/markdown-parsing.md](lessons/markdown-parsing.md) | `source-tree.ts`, `source-paths.ts`, `insertProseNodes`, frontmatter, synthetic nodes |
| Performance and lifecycle | [lessons/perf-and-lifecycle.md](lessons/perf-and-lifecycle.md) | render queue, DOM caches, `destroy()`, recursion limits |
| Testing | [lessons/testing.md](lessons/testing.md) | vitest mocks, jsdom limits, E2E/CDP harness |
| Build, release, plugin review | [lessons/build-and-review.md](lessons/build-and-review.md) | webpack, dependencies, `eslint.config.js`, release workflow, store review |
| Appendix (unverified) | [lessons/appendix.md](lessons/appendix.md) | low-confidence notes; verify before relying on them |

## Open items

- [ ] Verify the code-block view's incremental update in a real Obsidian.
- [ ] Optional: add a `move` edit type to `TreeEdit` so a moved node keeps its own fold
      state (today the moved node is rebuilt, its neighbour is preserved).

## Superseded rules

Kept only so an old comment or commit message that cites them can be resolved. Do not
follow them.

| Old rule | Where it lived | Replaced by |
| --- | --- | --- |
| Editor width `= max(nodeRect.width, 120)`, and later `trustRect` deciding "cover the node vs measure the text" | old §17, §21 | `Rect.trustWidth` + `Rect.mask` (hide the node's own text) — `lessons/inline-editing.md` |
| "Track the new node's position for `duration + 300ms`" (fixed window) | old §16 (first version) | event-driven `MutationObserver` + re-armed window + follow-while-moving — `lessons/inline-editing.md` |
| `centerSubtree()` to recenter after fold/unfold | old fold behaviour | `markmap.fit()` via `fitContent` — `lessons/rendering.md` |
| Duplicate copies of the old §16 and §26 sections | this file | removed; single rule each in `lessons/` |

## Maintenance

- One rule per heading, imperative title. Symptom → root cause → do/don't. Trim
  anecdotes: keep only the fact that discriminates the right fix from the wrong one
  (measured numbers, API names, timings).
- Never leave two rules that contradict each other. Rewrite the old one and add a row
  to the table above.
- No duplicated blocks, no stray shell lines. `grep -n '^## '` must not repeat a title.
- Numbers that came from a real measurement (px, ms, MB) are the valuable part; keep
  them, do not round them away.
