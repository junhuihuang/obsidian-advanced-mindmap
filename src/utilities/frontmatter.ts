import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * Frontmatter handling for notes and `markmap` code blocks.
 *
 * This replaces `gray-matter`, whose YAML backend bundles a JavaScript parser
 * and a string-executing engine into the plugin. Only the `---` YAML form that
 * Obsidian itself uses is supported here, and it is read/written with the `yaml`
 * package the renderer already depends on.
 */

const DELIMITER = '---'

export type FrontmatterData = Record<string, unknown>

/** Splits `---` frontmatter off `text`; leaves `text` alone when there is none. */
export function parseFrontmatter(text: string): { data: FrontmatterData, content: string } {
  if (!text.startsWith(`${DELIMITER}\n`) && !text.startsWith(`${DELIMITER}\r\n`))
    return { data: {}, content: text }

  // Start of the frontmatter body (the line after the opening delimiter).
  const start = text.indexOf('\n') + 1
  const end = text.indexOf(`\n${DELIMITER}`, start - 1)
  // An unterminated block is not frontmatter: keep the text as content rather
  // than parsing (and later rewriting) the rest of the note as YAML.
  if (end === -1) return { data: {}, content: text }

  const parsed: unknown = parseYaml(text.slice(start, end).replace(/\r\n?/g, '\n'))
  let content = text.slice(end + 1 + DELIMITER.length)
  if (content.startsWith('\r')) content = content.slice(1)
  if (content.startsWith('\n')) content = content.slice(1)

  return { data: isRecord(parsed) ? parsed : {}, content }
}

/** `content` prefixed with a `---` YAML block, or unchanged when `data` is empty. */
export function stringifyFrontmatter(content: string, data: FrontmatterData): string {
  const body = content.endsWith('\n') ? content : `${content}\n`
  if (Object.keys(data).length === 0) return body

  const yaml = stringifyYaml(data).trim()
  return `${DELIMITER}\n${yaml}\n${DELIMITER}\n${body}`
}

const isRecord = (value: unknown): value is FrontmatterData =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
