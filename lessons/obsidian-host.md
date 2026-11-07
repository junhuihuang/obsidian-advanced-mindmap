# Obsidian host integration

## Never hand-roll Markdown editing or previewing — use the host

Two implementations of "edit the Markdown source" were built and both were thrown away:
a `Shift + hover` floating `textarea` (awkward, needed hover grace periods), then a
toolbar button with a custom `textarea` panel — and the user's first sentence about it
was "use Obsidian's own editor, do not build one, and it lacks Markdown preview".

**Rule.** Any "edit/preview Markdown" requirement is delegated to the host:

- need **edit + preview** → open the same file in a split
  (`createLeafBySplit` + `openFile`): live preview, source and reading view, every
  hotkey and every plugin come for free and behave consistently;
- need **render only** → `MarkdownRenderer.render()`.

Never attach a `textarea` to the body to imitate an editor. The hidden cost of a
hand-rolled editor — focus stealing, swallowed hotkeys, indentation, undo, spellcheck,
syntax highlighting, preview — is redone for every host feature and always ends up worse.

## Host facts that keep biting (assume these are permanent)

1. **Focus is stolen.** `textarea.focus()` only sticks while that leaf is the active one;
   otherwise Obsidian/CodeMirror immediately moves focus to `.cm-content` or
   `BUTTON.mod-cancel`. Never use `blur` as the "close/save" trigger.
2. **Hotkeys are swallowed.** Obsidian handles global hotkeys in the `document` capture
   phase, so element-level listeners never see `Tab`, `Ctrl+S`, `Ctrl+Enter`, `Ctrl+Z`
   (only `Escape`, `Enter`, `Shift+Enter` arrive). If you need one, listen on **`window`**
   capture (order: window → document → element), then `preventDefault()` +
   `stopPropagation()`, and gate on `event.target === input`.
3. **`app.workspace.iterateAllLeaves()` can miss your own leaf** (a `.workspace-leaf`
   exists in the DOM but the callback never fires) — never reverse-look-up "which leaf am
   I in". An `ItemView` already has `this.leaf`; pass it down from the view layer.
4. **`layout-change` fires after `createLeafBySplit` but before `openFile` completes**, so
   the new leaf's `containerEl` is not in the document yet. Deciding "the user closed it"
   with `isConnected` misreads a leaf that is still opening and opens a new split on every
   click. Track an `opened` flag to distinguish "opening" from "closed".
5. **Plugin enablement lives in `localStorage`**:
   `localStorage.setItem("enable-plugin-" + app.appId, "true")`. Writing
   `.obsidian/community-plugins.json` alone is not enough.
6. **The Markdown parser's `$` anchor does not match lines containing `\r`** (`.` does not
   match `\r`), so CRLF documents are skipped wholesale.

## Entry points go in the view header actions

- Use `ItemView.addAction(icon, title, callback)` — it sits left of Obsidian's own
  "More options" button, matching the Markdown view. It **prepends**, so add actions in
  reverse of the desired order. Reflect active state with `.is-active`
  (`.clickable-icon.is-active` is built in).
- Do not resurrect `markmap-toolbar`'s floating `.mm-toolbar`: it is a separate overlay
  with foreign styling. For zoom, call `markmap.rescale()` / `markmap.fit()` directly.
- `addAction()` accepts Lucide icon names only. To keep old custom glyphs, call
  `addAction` and then replace the button's children with
  `<svg class="svg-icon" viewBox="0 0 20 20">` plus an **inline**
  `style="fill: currentColor; stroke: none"` — inline style is required to override
  `.svg-icon`'s `fill: none; stroke: currentColor`, otherwise filled shapes render as a
  nearly invisible outline. Using `currentColor` lets `.is-active` retheme it for free.
- Open the split with `createLeafBySplit(this.leaf, 'vertical')` +
  `leaf.openFile(file, { active: true })`, passing **no** `state` so the file keeps the
  mode the user last used.
- Close with `leaf.detach()` and listen to `layout-change` to resync the button, so it
  does not stay lit after the user closes the split manually.

## Persisting the split layout: walk the whole tree

**Do** traverse the **entire** `app.workspace.rootSplit` tree — not just one pane's
`rootSplit.children[0]`.

- Serialise with a version number: `{ version: 1, root: Tree }`.
- Restore legacy (array) formats, but never fabricate a pane that is missing.
- After every change, `layoutManager.renderVisible()` renders all root and nested splits
  recursively.

## Do not let the external-file poll clobber local edits

**Root cause.** Obsidian's layout notifications can trigger a disk read that overwrites
the in-memory document before the local edit has been written.

**Do**

- Track the last content you wrote (`lastWritten`).
- On an external file change, skip the update when the content matches `lastWritten`
  (you know you just wrote it). Otherwise it is a genuine external modification — take
  the full render path.
