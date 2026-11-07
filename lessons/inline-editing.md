# Inline editing (`src/editing/inline-input.ts`)

## The editor box is sized from the text; the *frame* must cover the node

Two different things were conflated for three iterations: the box **width** must cover
what `markmap` actually rendered, the **height** must come from the content. Getting one
right and the other wrong both look like "two boxes that do not line up".

**Do**

- **Height** is always content-driven:
  `Math.max(rect.lineHeight ?? 0, input.scrollHeight)`. Never use the node's
  `rect.height` — for a new node the resolved rect belongs to the *anchor* (parent or
  previous sibling), which may be a big root label or have `nodeMinHeight` padding, and
  it inflates the editor.
- **Width**: `Math.max(nodeRect.width, measure(text))` once the rect is the real target
  node; `measure(text)` only while the rect is still the anchor.
- Measure text with a hidden `white-space: pre` mirror element whose font, size and
  line-height match the editor exactly, then
  `width = clamp(ceil(textWidth) + 1, MIN_WIDTH, maxWidth)`. Do **not** flip the wrap
  attribute and read `scrollWidth`: the cursor jumps.
- Set `height: auto` before reading `scrollHeight`. With `overflow: hidden`,
  `scrollHeight === clientHeight`, so one oversized measurement is then remembered
  forever.
- After the first keystroke, drop the node-height lower bound so the box shrinks when
  characters are deleted.
- Give the editor `overflow: hidden`; otherwise the reserved scrollbar width turns a
  line that just fits into two lines.

**`maxWidth` comes from the DOM, not from options.** `markmap` writes the `maxWidth` it
actually used onto `<svg>` as the `--markmap-max-width` custom property (CSS default
`9999px` = no wrapping). Read it with `getComputedStyle(svg)` and multiply by the scale
from `getScreenCTM()`. That automatically follows the global setting, per-file
frontmatter and code-block parameters without threading options from the renderer into
the editor. Treat `>= 9000` as "unlimited".

**Measured (`maxWidth: 400`).** node `短` 16×20 → editor 17×20; +10 CJK chars →
161×20 (one line, no wrap); after commit 160×20. Long text: editor 400×60 → node
400×60. At `zoom 2`: 32×40 → 321×40 → 320×40.

## Hide the node's own text while editing — do not rely on the box covering it

**Symptom.** A new node showed two copies of its text side by side (`de` sticking out to
the right of the editor). Double-click editing the same node showed only one.

**Root cause.** Width was computed from the **source text**, but the rendered node can be
wider: an ordered list renders `2. New node` for source `New node`. Measured in the real
app (CDP): `editor w=110`, `node w=133.54`, `left/top` identical — the 23.5 px
difference is exactly the `2. ` prefix. Position tracking was correct all along, which
is why chasing animation timing never fixed it.

**Do**

- `Rect.trustWidth`: decide **per frame** whether the rect that `resolve()` returned is
  actually the target node. Not "was a resolve passed in" — `trustRect: !resolve` was
  exactly that bug.
- `Rect.mask` = the node's `.markmap-foreign`; set `visibility: hidden` while editing and
  restore the previous value on close. Then there is only **one** copy of the text on
  screen, so no width, position or animation difference can reveal a second one.
  `visibility: hidden` does not affect layout, so `getBoundingClientRect()` and the
  editor geometry stay exact.
- Re-apply the mask on **every** `position()` (including the `fast` path): `markmap`
  rebuilds content on re-render, and for a new node the mask target moves from the
  anchor to the real node.
- When `trustWidth` flips false → true, force one full measurement, otherwise the box
  stays narrow until the 200 ms idle re-check.

**Verified (real Obsidian, CDP).** New node: editor and node identical to the pixel
(`133.54×35.33`), node hidden. Double-click edit of the same node: pixel-identical
screenshot (`0` diff). Typing still shrinks the box to the text; the node's own text
reappears on commit.

**Rules of thumb**

- If two copies of a text can overlap, keep only one. "The box happens to cover the node"
  is fragile: a few px wider, narrower, or one frame late and it shows.
- When the symptom is "two texts" / "boxes not aligned", measure
  `getBoundingClientRect()` and report **x/y and w/h separately**. Correct position with
  wrong width is a different bug from a lagging position.

## Position tracking: event-driven, re-armed, and follow motion — not a fixed window

**Symptom.** Creating a node showed two `New node` nodes far apart; `Enter` left one.

**Root cause.** Not a duplicated insert. The editor opens **immediately** (it does not
wait for the async render or the disk write), so it hangs on the **anchor** (parent or
previous sibling) and must hop to the node once `markmap` renders it. The old
implementation only ran `trackPosition()`'s timer for `animationDuration + 300 ms`;
after the window expired it never updated again. In practice "write queue + re-read file
+ incremental render" can exceed 800 ms (large file, slow device, queued writes), so the
editor stayed on the anchor permanently.

**Do (all three, they are not alternatives)**

1. **Event-driven.** Pass `observe: svg` to `openInlineInput`; while the editor is open,
   a `MutationObserver` on the mindmap's `childList` recomputes the position;
   `disconnect()` in `finish()`. Watch `childList` only — `markmap` rewrites `class` and
   `transform` every frame.
2. **Re-arm.** An entering node is drawn at its parent's position and then **slides**.
   A mutation that only calls `position()` once lands on frame 0 of that animation, so
   mutations must reset the tracking window (`end = now + duration + 300`, keep the
   `rAF` loop running).
3. **Follow "still moving", not "elapsed time".** Each frame compares rects and pushes
   `end` back while the node is still moving (a second render can start a fresh
   transition with no structural change at all). After the window expires, keep
   re-checking every 200 ms until the editor closes. Wrap `position()` in `try/catch` so
   one transient layout error cannot kill the loop.

With (3) any lost mutation, underestimated duration or extra pan costs at most a 200 ms
delay instead of a permanently misplaced editor. Measured in real Chrome with a 500 ms
`markmap` animation: max deviation 0 px during entry; after the animation stopped,
teleporting the node by 60 px was followed within 300 ms.

**Reading the symptom.** A small fixed offset ("it is only 40 px off") means tracking
**stopped too early**, not that tracking never started. The iteration order was: fix (1)
→ editor sat on the parent's column; add (2) → editor on the right row, 40 px off
(stuck mid-slide); add (3) → stable.

**Resolving "where is the new node": path first, line as fallback**

```ts
const byPath = findGroupByPath(path)          // the inserted node's path is new: most precise
if (byPath && !known.has(byPath)) return byPath
const byLine = findGroupByLine(line)          // siblings keep their line, but paths below shift
return byLine && !known.has(byLine) ? byLine : anchor
```

## Keep the tracking loop cheap: `position(fast)` and `transition: none`

**Symptom.** Visible jitter while a new node animated in.

**Root cause.** `position()` did three layout reads per frame (`getBoundingClientRect`,
mirror measurement, `scrollHeight`). During a d3 transition every read forces a reflow
that fights the GPU transition. Additionally, a theme can attach a CSS `transition` to
`textarea`, so the editor interpolates towards a position that keeps moving and visibly
trails behind.

**Do**

- Keep `rAF` (it is what synchronises with the browser's frame), but add a `fast` mode
  used while the node is animating: read `getBoundingClientRect()` (left/top) only, skip
  the mirror measurement and `scrollHeight`; do the full measurement when idle. Three
  layout reads per frame become one.
- Set `transition: none` explicitly on the editor. A `position: fixed` overlay must not
  inherit theme transitions.

**Don't** switch the loop to `setTimeout` — it is out of phase with the render cycle and
produces a worse trailing effect.

## Commit user-visible state before the `await`

**Symptom.** Pressing `Enter` left a ~500 ms dead gap before anything was highlighted.
`Tab` did not.

**Root cause.** `saveText` → `await commit()` → `applyChange` → `setMarkdown` →
`writeMarkdown` → `render` → 500 ms `markmap` transition. `selectOnly(path)` ran
**after** `await commit()`, so the editor closed into an unhighlighted void for the whole
async chain. `Tab` had no such gap: `editNewNode` calls `selectOnly(path)` +
`openTextEditor` synchronously.

**Do** highlight first, then submit: `selectOnly(path)` **before** `await commit(...)`.
Async work (render, disk) belongs in the background and must not gate immediate visual
feedback.
