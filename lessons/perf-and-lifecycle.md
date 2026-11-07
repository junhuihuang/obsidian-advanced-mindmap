# Performance and lifecycle

## Batch edits — one parse and one render, not N

**Do**

- Multi-delete: merge the paths, filter lines once, produce a single result.
- Scan the DOM once and build all caches from it (source tree, search, visible paths, DOM
  index).
- Keep a `latest-only` render queue so fast consecutive edits skip stale intermediate
  states instead of rendering each one.

## `domIndex()` only refreshes when a node is disconnected

**Root cause.** The cache is invalidated only when `isConnected === false`.

**Do**

- In tests, pair `setMarkdown` with `render()` so `svg.replaceChildren()` disconnects the
  old nodes and the cache refreshes. If the DOM is not rebuilt, the cache keeps pointing
  at the old nodes forever and `advmmSourcePath` no longer matches.
- In production, `renderData()`'s D3 enter/exit handles DOM replacement naturally.

## `destroy()` must release everything, in order

**Root cause.** Renderer, editor, `markmap` instance, SVG observer and async tasks that
survive teardown leak memory, leave listeners behind and collide with React/VDOM.

**Do** in `destroy()`: `observer.disconnect()` → `removeEventListener` →
`clearTimeout`/`clearInterval` → drop references. `TreeUpdater.update()` ignores calls
for a destroyed renderer.

## Recursive work needs a hard limit

Unbounded recursion in the render path can hang the app; cap it and signal the cap
explicitly rather than silently truncating (a wrong signal produces wrong expansion
levels). Synthetic roots (view-only nodes that have no source counterpart) must be
handled explicitly — see `markdown-parsing.md`.
