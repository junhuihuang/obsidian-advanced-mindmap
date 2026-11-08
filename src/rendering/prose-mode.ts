/**
 * How much of a note's plain text a canvas draws.
 *
 * A canvas remembers this itself: it is a view switch, not a note setting, and
 * never touches the markdown.
 *
 * - `always` — every paragraph is a node (prose reads like the preview).
 * - `smart` — only the paragraphs that introduce a rendered block (the line
 *   before a `1.` / `-` list, a table or a code block). A list without that line
 *   loses its context, so it is not plain text.
 * - `never` — only headings, lists, tables and code blocks.
 */
export type ProseMode = 'always' | 'smart' | 'never'

/** The three modes, in the order the header button cycles through them. */
export const PROSE_MODES: readonly ProseMode[] = ['always', 'smart', 'never']

/** The mode the header button switches to on its next click. */
export function nextProseMode(mode: ProseMode): ProseMode {
  return PROSE_MODES[(PROSE_MODES.indexOf(mode) + 1) % PROSE_MODES.length]
}

/** What `transformMarkdown` needs to draw a canvas in this mode. */
export function proseTransformOptions(mode: ProseMode): { prose: boolean, structuralOnly: boolean } {
  return { prose: mode !== 'never', structuralOnly: mode === 'smart' }
}
