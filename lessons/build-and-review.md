# Build, release, and plugin review

## Keep the local lint equal to the review config

Obsidian's review runs `obsidianmd.configs.recommended` (which includes
`typescript-eslint`'s `recommendedTypeChecked`). Every round before that was spent
"waiting for the review to tell us". Put the same config into `eslint.config.js` plus
`parserOptions.projectService` (the review environment provides it, a plugin config does
not), and the pre-commit run reproduces the review list.

- The review reports a **subset** of that config (one round only reported
  `eslint-comments/*` + `no-misused-new`). Do not estimate the work from a full run —
  `no-undef` / `prefer-window-timers` / `no-static-styles-assignment` fire 200+ times and
  are never reported.
- To simulate the "dependency install failed" review environment, disable type-aware
  rules via `tseslint.configs.disableTypeChecked.rules`.
- **Config-level** overrides in `eslint.config.js` are not inline disables and pass
  review — use them, with a stated reason, for files where the rule is meaningless:
  `webpack.config.mts` / `vitest.config.ts` (`no-nodejs-modules`,
  `hardcoded-config-path`) and `src/**/*.test.ts`
  (`no-unnecessary-type-assertion` — `--fix` corrupts the `closest` assertions there).
- Inline disables are constrained: `require-description` needs the reason in the **same**
  directive comment; `no-restricted-disable` **forbids** disabling `obsidianmd/*`,
  `@typescript-eslint/no-explicit-any`, `no-eval` and friends; `disable-enable-pair`
  (`allowWholeFile: false`) needs a matching `eslint-enable`.
- Trade-off worth remembering: an inline-disable *error* usually suppresses only a
  *warning*. Deleting the disable and leaving the warning is cheaper than rewriting the
  code — unless the rule is one of the `no-restricted-disable` names.

## Bundle size must stay under 5 MB

**Root cause of an 11 MB `main.js`.** `webpack.config.mts` had
`devtool: argv.mode === 'production' && 'eval-source-map'`. The comparison is true in
production, so the whole source map was inlined. Fix:
`argv.mode === 'development' ? '<map>' : false` → 1.99 MB. The bulk is `markmap-lib`'s
full `highlight.js` language set plus `katex`; nothing had to be dropped.

- Guard it: the release workflow fails on `main.js` > 5 MB.
- Users on Obsidian Sync's Standard plan cannot sync files over 5 MB — this is not a
  cosmetic limit.

## Release assets need notes and provenance

- `softprops/action-gh-release` with `generate_release_notes: true` (a release without
  notes is a review finding).
- `permissions: { id-token: write, attestations: write }` and
  `actions/attest-build-provenance@v2`, with `subject-path` listing **every** asset —
  `main.js`, `manifest.json`, `styles.css`. A new asset must be added there too.

## No dynamic code execution in the bundle

**Root cause.** `gray-matter`'s YAML backend is `js-yaml@3`, whose `DEFAULT_FULL_SCHEMA`
bundles the `js/function` type (`esprima` + the `Function` constructor) and the
`engines.javascript` string engine. Replacing it with our own
`src/utilities/frontmatter.ts` (using the `yaml` v2 we already depend on) removed every
dynamic-execution keyword and `esprima` from `main.js`, and 2.0 MB → 1.81 MB.

It also fixed a latent crash: `GrayMatter.stringify(body, data)` throws `TypeError` when
`body` is a string (`file.content` undefined) — writing file-level settings from a code
block had always been broken.

**False positives.** Reviewers flagged "dynamic code execution" while the bundle contained
zero `eval(` / `new Function`. They may scan source text or the previous release, so also
rewrite such literals in comments and docs, and keep the dev `devtool` at
`inline-source-map` so dev output contains no `eval(`.

**Finding the source.** `grep` only proves presence. Print context
(`s.slice(i-200, i+200)`) until you can identify the dependency.

## CSS: no `!important`, no `:has`

- `[hidden] { display: none !important }` existed because `.setting-item { display: flex }`
  has the **same specificity**. Set `node.hidden` (semantics) *and*
  `node.style.display = 'none'` (inline wins over any selector) in JS and delete the rule.
- `cursor: grabbing !important`: repeat a class instead —
  `.advmm-editor-container.advmm-dragging.advmm-dragging *`.
- `:has(.block-language-markmap)`: `:has` invalidates over the whole subtree and is
  expensive in an editor. Add `advmm-markmap-embed` (`cssClasses.markmapEmbed`) to the host
  block **at render time, inside `doRender()`**, and remove it on unload. Not in the
  renderer constructor — the parent may not be in the DOM yet (same reason as
  `advmm-highlight-inline`).

## Dependencies: delete what has no fix, override what does

- `serialize-javascript` (RCE in `<=7.0.2`) came from `copy-webpack-plugin`. Delete the
  plugin and copy `styles.css` / `manifest.json` in a ~15-line `afterEmit` hook (skip when
  src == dest, which is true because production output is the repo root).
- `deepmerge` (prototype pollution; **no fixed version upstream**) came from
  `fork-ts-checker-webpack-plugin`. Delete it and put `tsc --noEmit` into the `build`
  script.
- `overrides` are acceptable: `katex ^0.18.2`, `minimatch ^11.0.3`, `moment ^2.31.0`
  (verified working with `markmap-lib`'s `$$…$$` pipeline and the eslint stack).
- Keep `dependencies` to what is actually bundled into `main.js`; build, test and type
  tooling belong in `devDependencies`.
- **The review scans the whole lockfile**, so a vulnerable *devDependency* build tool is
  still reported.

## `npm ci` must work from a clean clone

The review runs `npm ci`, which fails outright without `package-lock.json` (a repo with
only `pnpm-lock.yaml`). Do not paper over it with `.npmrc legacy-peer-deps=true`: that makes
npm dedupe `ajv-keywords@5` onto `ajv@6`, `npm ls` reports invalid and webpack fails with
`Cannot find module 'ajv/dist/compile/codegen'`. Without `.npmrc` the peer conflict does
not exist (npm 11 installs a nested `obsidian@1.12.3`). Commit `package-lock.json`, drop
`pnpm-lock.yaml` and the `pnpm` field, and use `npm ci` / `npm test` / `npm run build` in
the release workflow.

## Type-checked warnings: the recurring shapes

- **floating promises** (`~32`): `import()`, `view.render()`, `plugin.saveData()`,
  `markmap.fit()` / `setData()`, `openLinkText()` are fire-and-forget → prefix `void` to
  state the intent.
- **`no-misused-promises` via `Resolve<T>`**: a `(resolve) => void` signature makes a
  single-expression arrow that returns a builder look thenable. Give the resolver
  function's return type `unknown` instead of wrapping every call site in braces.
- **unsafe `any`**: `yaml.parse()` → `const parsed: unknown` + `isRecord()` narrowing;
  `useDefaultsForMissingKeys(data)` takes `unknown`; `Object.create(x)` → `as X`;
  `s.data?.href.contains()` → `(style.data as { href?: string }).href?.includes()`.
- **unbound-method**: d3 and event emitters need the receiver —
  `markmap.zoom.transform.bind(markmap.zoom)`, `events.listen.bind(events)`, or wrap in an
  arrow.
- **`no-unnecessary-type-assertion` + generic defaults**: in an assertion context
  `Element.closest<E extends Element = Element>` infers `E = SVGGElement`, so the rule
  calls `as SVGGElement | null` redundant — but deleting it makes `tsc` fail. Write the
  type parameter explicitly: `closest<SVGGElement>('msg')`.
- **`no-array-delete`**: `delete arr[i]` leaves a hole. Use `(Listener | undefined)[]` and
  assign `undefined` — not `splice`, because other closures hold indices into that array.
- **deprecated APIs**: `MarkdownRenderer.renderMarkdown` →
  `MarkdownRenderer.render(app, md, el, path, component)`. Pass each embed its **own**
  `Component` (`no-plugin-as-component`: a plugin-as-component keeps rendered children
  alive until unload).
- **`createElement` / `querySelectorAll` "deprecated" is a false positive**: the
  `HTMLElementDeprecatedTagNameMap` overload is tagged `@deprecated`, and referencing the
  property hits the whole overload set. `document.createElementNS('http://www.w3.org/1999/xhtml', tag)`
  is equivalent and avoids it; to wrap `querySelectorAll`, read the original with
  `Reflect.get(svg, 'querySelectorAll')` — and **call the extracted function** inside the
  wrapper, otherwise it recurses until `Maximum call stack size exceeded` (the counter
  reached 10679 before it was noticed). Give the `const` a type annotation instead of `as`.
- **Vault Enumeration**: `vault.getMarkdownFiles().find(...)` → `vault.getAbstractFileByPath(path)`
  + `instanceof TFile` (test doubles need `new TFile()` and a stubbed
  `getAbstractFileByPath`).

## The settings tab keeps its custom renderer

`settings-tab/no-deprecated-display` (`prefer-setting-definitions`) looks for a
`getSettingDefinitions` **member**. Implementing it is *not* free: it hands rendering to
Obsidian's declarative UI, which cannot express this plugin's paged settings, inherited
values and live preview.

**Do** return `[]` from `getSettingDefinitions()` and install the existing renderer as
`Object.defineProperty(this, 'display', { configurable: true, writable: true, value: … })`.
Verified against the app bundle: `renderTab` does
`this.settingItems.length > 0 ? f4(this) : this.display()`, so an empty array still calls
`display()`. Delete any empty `public display() {}` member — the rule only fires when both
members exist — and drop the `no-deprecated` override that was there for this file.

**General trick.** To keep behaviour while avoiding a deprecated name, use a **string
key** (`Object.defineProperty`, `Reflect.get`); the compiler never resolves it to the
deprecated declaration, and it is far more precise than disabling a rule.

## Inspect the app bundle when runtime behaviour is unclear

```bash
npx @electron/asar extract /usr/lib/obsidian/obsidian.asar /tmp/ob
```

Then read/grep `app.js` for the function in question (this is how the `renderTab` branch
above was confirmed). Also: `pkill -f "electron.*app.asar"` matches its own command line
and kills the shell — write `pkill -f "app[.]asar"`.

## Repo hygiene: dead code and refactor passes

- Use `ts-prune` to find exported-but-unreferenced symbols, then separate **truly dead**
  from **over-exported** (used inside its own module) — the latter is not worth deleting.
- Two things `ts-prune` cannot see, and neither is dead: the `obsidian` alias used by
  `src/test-utils/obsidian.ts`, and `@codemirror/state` / `@codemirror/view` (peer deps
  of `obsidian`, which `obsidian.d.ts` imports directly).
- Previous passes removed: a custom `Set` wrapper, `MD_VIEW_TYPE`, a singular
  `defineLazyGetter`, unused callbag operators (`of`, `pairwise`, `take`, `startWith`,
  `replay-all`) and their packages, `ramda`, a duplicated `container?.focus()`.
- Extracting helpers is the cheap way to shrink `node-editor.ts`: functions that do not
  touch closure state (`findNodeGroup`, `findAnyNodeGroup`, `sameDropTarget`, `isTextInput`,
  `clearNativeSelection`, `isInteractiveTarget`, `DRAG_THRESHOLD_SQUARED`) live in
  `src/editing/editor-helpers.ts`.
- When a timer exists only to wait for an animation, skip it for `duration <= 0`
  (`recenterAfterFold`) and have tests pass `getAnimationDuration: () => 0` — no
  meaningless delay, no flaky waits.
