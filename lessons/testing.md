# Testing

## `setMarkdown` mocks: pick the one that matches the assertion

`applyChange` internally does `await setMarkdown(next)`, so a mock that never resolves
blocks every later assertion.

```ts
// asserting on selection state — resolve AND re-render
setMarkdown: async next => { md = next; render() }

// asserting only that it was called — resolve, no re-render
setMarkdown: vi.fn((_markdown: string) => Promise.resolve())

// asserting the pending/editor-still-open state — never resolve
setMarkdown: vi.fn((_markdown: string) => new Promise<void>(() => {}))
```

**Don't** assert on selection with a non-resolving mock (the test hangs) or with a
resolving mock that skips `render()` (the `domIndex()` cache stays stale and
`advmmSourcePath` no longer matches the new path).

## jsdom cannot prove geometry — measure in a real browser

Layout-related bugs (editor box, drag, fit) are invisible to jsdom. Recipe:

1. `vite` a throwaway page that calls `Markmap.create()` on a small tree with
   `duration: 0, autoFit: false` and imports the **real** functions from `src/`.
2. Drive it over CDP: call `openInlineInput`, then `Input.insertText` to simulate typing.
3. Compare the editor's box with the node's box after re-running `setData` with the new
   text.

Prefer plain Chrome with a standalone page for geometry; attach to Obsidian when the
question involves host behaviour.

**Feed frames.** An Electron/Obsidian E2E window without compositor frames never fires
`requestAnimationFrame`, so `markmap.renderData()` hangs on
`await new Promise(requestAnimationFrame)`, every node reports a 0×0 rect, and it looks
like "clicks do nothing / selection is broken". Use `Page.startScreencast` or
`Page.captureScreenshot` to supply frames.

**Attach to the real app**

```bash
obsidian --remote-debugging-port=9222
curl -s http://127.0.0.1:9222/json/list | grep webSocketDebuggerUrl
```

Then drive it from Node's built-in `WebSocket` with `Runtime.evaluate` — e.g.
`tab.update(); tab.renderTab()` to confirm what actually rendered. This is far more
reliable than screenshots plus synthetic clicks and needs no extra input tooling.

**Reproduce interactions honestly.** Use CDP `Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent`; `Runtime.evaluate`-synthesised events are not equivalent. Before
clicking, check `document.elementFromPoint(x, y)` is the element you mean — a pane
covering the toolbar makes coordinate clicks fail silently.

**Count panes with visible elements** (`offsetParent`) or `.workspace-leaf`, not
`data-type` (that includes background tabs).

**Test the current build.** `md5sum` the deployed `main.js` against the freshly built one
before believing any measurement.

**Clean up.** `ws.close()` or the script hangs. `pkill` restarts the CDP port only after
~10 s.

## Reproducing "render arrives late" in jsdom

This one *is* testable in jsdom, and removes the need to reason about timing by hand:

1. Make `setMarkdown` return a never-resolving promise (the editor still opens at once —
   proving it does not wait for the write).
2. Push `performance.now` 10 s ahead so the timer-driven tracker is expired.
3. Simulate the render plus the `model` update and assert the editor's `left` equals the
   new node's content `left`.

Place every node in a **different column** (e.g. pre-order × 100 px), otherwise a
sibling shares the anchor's column and the test passes for the wrong reason.

To test the re-arm behaviour, animation needs a **real clock** (`vi.restoreAllMocks()`);
a frozen `performance.now` never ends the tracking loop:

1. `Tab` to create a node, `setTimeout(400)` to pass the initial window (`duration: 0` →
   300 ms window).
2. Render the new node at `left: 10` (the parent's column), then move it to `left: 100`
   across frames (mimicking d3's transform tween).
3. Assert the editor ends at `left === '100px'`. Removing the re-arm makes this fail.

## E2E and `markmap` animations

`markmap.renderData()` animates with d3 transitions, so reading `payload.fold` or DOM state
immediately can observe a mid-transition value.

**Do** wait past the animation (`setTimeout(r, 500+)`) or render with animations disabled
for the assertion. Note that an Obsidian window must be focused for animations to
complete — Electron throttles/pauses them in background windows.
