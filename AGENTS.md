# Notes for coding agents

## Before you change code

1. Read [LESSONS.md](LESSONS.md) — a short index of rules, each pointing at one file
   under `lessons/`. Then read **only** the topic files your change touches (they are
   grouped by subsystem, not by date).
2. Hard rules that have already cost this project a rework cycle:

   - **Never render an edit with `markmap.setData()`.** Every insert / delete / text
     change / move goes through `TreeUpdater` (a `TreeEdit` per operation) +
     `renderData()`, or all fold state is lost. → `lessons/rendering.md`
   - **One rendered node per source path.** Duplicate paths fail silently — selection,
     edit and fold then hit the wrong node. → `lessons/markdown-parsing.md`
   - **Do not hand-roll Markdown editing or preview.** Use Obsidian: split leaf +
     `openFile`, or `MarkdownRenderer.render()`. → `lessons/obsidian-host.md`
   - **Never size the inline editor from the node's rect or from the source text
     alone.** Measure the text, cover the rendered node, and hide the node's own text
     (`visibility: hidden`) while editing. → `lessons/inline-editing.md`
   - **User-visible state updates synchronously.** Highlight / selection / editor open
     before `await`; rendering and disk writes must not delay it.
   - **No `!important`, no `:has()`.** Use inline style, a repeated class name, or a
     class set at render time. → `lessons/build-and-review.md`
   - **Geometry cannot be proven in jsdom.** Measure in a real browser over CDP.
     → `lessons/testing.md`
   - **Obsidian's review runs `obsidianmd.configs.recommended`.** Keep the local
     `eslint.config.js` equal to it so the review has nothing new to report.
     → `lessons/build-and-review.md`
3. Verify before you call it done:

   ```bash
   npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
   ```

## Deployment

Local development is not finished when the code is written and `tsc` / `eslint` /
`vitest` / `npm run build` pass — **deploy locally**, do not stop at a build artifact:

```bash
npm run deploy
```

- Equivalent to `npm run build` + copying `main.js`, `styles.css`, `manifest.json`
  into `$VAULT/.obsidian/plugins/advanced-mindmap/` (default vault: `~/vault`).
- Use a different vault with `VAULT=/path/to/vault npm run deploy`, or point the
  destination directly at `PLUGIN_DIR=/path/to/.obsidian/plugins/advanced-mindmap`.
- **Never overwrite `data.json` in the plugin folder** (that is the user's settings;
  the script does not touch it).
- After deploying, tell the user to reload the plugin (toggle it off and on) for the
  new build to take effect.

## Adding a lesson

Do not append a diary entry to `LESSONS.md`; the index is deliberately short. Add the
rule to the matching `lessons/*.md` file, and add a line to the index only if the rule
is broad enough to belong in the always-loaded list above. When a new rule invalidates
an old one, rewrite the old rule in place and record the supersede in
[LESSONS.md](LESSONS.md#superseded-rules). The old prose-only, Chinese `LESSONS.md`
stays in git history if you need the original anecdote.
