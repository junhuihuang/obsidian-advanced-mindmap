# Markdown parsing and node mapping

## One source path must map to exactly one rendered node

A duplicated path fails **silently**: `domIndex().byPath` is last-write-wins, so
selection, editing and folding of one node hit the other. This has caused two separate
bugs (image nodes, root node). Assert it in tests rather than eyeballing nodes:

```ts
const rendered = paths(root).sort()
expect(new Set(rendered).size).toBe(rendered.length)
```

See `source-paths.integration.test.ts` ("one source path per rendered node").

## `markmap` already renders image-only paragraphs — do not insert them again

**Root cause.** `insertProseNodes` assumed `markmap` renders only headings, lists, code
and tables, and that every other paragraph must be added by us. But `markmap-html-parser`'s
`defaultOptions` selector is `h1..h6,ul,ol,li,table,pre,p>img:only-child`: a paragraph
containing nothing but an `<img>` **is** rendered as a node. Result: two nodes on the
same source path and a duplicated image on the canvas.

**Do** check `byPath.get(pathKey(path))` before handling each paragraph:

- exists (already rendered) → **reuse** that node; leave its position alone (`markmap`
  already placed it in source order), attach the paragraph's rendered children, and
  re-render `content` from the full paragraph text via `renderInline` (caption text next
  to the image is dropped by `markmap`);
- missing → `makeParagraph` and insert.

Never "delete and rebuild": reuse keeps the DOM, `payload.lines` and the existing fold
state.

**Investigating.** Do not guess what `markmap` rendered. Dump the tree:
`node -e "const {Transformer}=require('markmap-lib'); …"` and print `transform(md)`.

## A render-only root must be detected by "no document lines", not by empty content

**Symptom.** For a note whose root came from frontmatter, the map showed two
identically-named nodes and selecting the root highlighted the inner one.

**Root cause (two layers).**

1. `markmap` fills a text-less root with the frontmatter title
   (`root.content ||= frontmatter.title`). A note without an `H1` has a synthetic root
   exactly for this. `addTitleToRootNode` only checked `root.content === ''`, saw the
   title, assumed it was the document's own root, and wrapped another filename layer
   around it → two layers with the same name.
2. The wrapping layer (`tagSyntheticRoot`) and the inner root (`tagSourcePaths` defaults
   to `[]`) **shared source path `[]`**. The inner node comes later in the DOM, so
   `findGroupByPath([])` resolved to the inner one while the root was the one selected.

**Do**

- Decide "render-only root" with `getSourcePath(root)?.length === 0` (no document lines =
  synthetic/title container). Write the title in place instead of wrapping, and keep any
  title that frontmatter already provided.
- In `tagSourcePaths`, a root `ul`/`ol` **never** gets a document path (check
  `payload.tag`): its content can only be the frontmatter title, and its `data-lines`
  start at the first list item, so line-based tagging would make the root share the first
  item's path. Same class of problem as `isParagraphContainer`: a container node must not
  steal its children's path.

## A note that starts with `# H1` names its own root — do not wrap the file name above it

**Symptom.** A note with `# My note` at the top rendered the title twice:
`My note → My note → …`. The outer layer was the file name.

**Root cause.** `markmap` promotes the document's single top-level node to the root, so
for `# My note` the root *is* the note's heading. `addTitleToRootNode` only asked "does
the root have text?", saw the heading and wrapped `file.basename` around it.

**Do**

- `titleWrapsRoot(root)` decides, and only wraps when the root is a real document node
  that is **not** the note's `H1` (a lone list item, a document starting at `## H2`).
  `markmap` keeps the tag it rendered from in `payload.tag`, so `payload.tag === 'h1'`
  identifies the note's heading — do not compare text with the file name.
- Keep `expandLevelWithTitle` in sync with that decision: only a wrapper adds a level, so
  `renderer-tab.ts` shifts `initialExpandLevel` **only** when `titleWrapsRoot` is true.
  Naming a textless root in place adds no level, and neither does leaving an `H1` alone.

**Why not "any top-level heading".** Several `#` headings produce a synthetic textless
root (`markmap` cannot pick one); that root has no title of its own and is named in
place, which is the wanted result.
