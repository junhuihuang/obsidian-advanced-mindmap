import { describe, expect, it } from 'vitest'
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('returns the text untouched when there is no frontmatter', () => {
    expect(parseFrontmatter('# Root\n- a\n')).toEqual({ data: {}, content: '# Root\n- a\n' })
  })

  it('splits a YAML block off the content', () => {
    expect(parseFrontmatter('---\nmarkmap:\n  maxWidth: 400\n---\n# Root\n')).toEqual({
      data: { markmap: { maxWidth: 400 } },
      content: '# Root\n',
    })
  })

  it('handles CRLF documents', () => {
    expect(parseFrontmatter('---\r\nmarkmap:\r\n  height: 200\r\n---\r\nbody\r\n')).toEqual({
      data: { markmap: { height: 200 } },
      content: 'body\r\n',
    })
  })

  it('treats an unterminated block as content instead of eating the note', () => {
    const text = '---\nnot frontmatter\n'
    expect(parseFrontmatter(text)).toEqual({ data: {}, content: text })
  })

  it('ignores non-mapping frontmatter', () => {
    expect(parseFrontmatter('---\n- a\n- b\n---\ntext')).toEqual({ data: {}, content: 'text' })
  })
})

describe('stringifyFrontmatter', () => {
  it('returns the content when there is nothing to write', () => {
    expect(stringifyFrontmatter('body', {})).toBe('body\n')
    expect(stringifyFrontmatter('body\n', {})).toBe('body\n')
  })

  it('writes a YAML block in front of the content', () => {
    expect(stringifyFrontmatter('body\n', { markmap: { height: 200 } }))
      .toBe('---\nmarkmap:\n  height: 200\n---\nbody\n')
  })

  it('round-trips what it parsed', () => {
    const text = '---\nmarkmap:\n  coloring: depth\n  depth1Color: "#cb4b16"\n---\n# Root\n'
    const { data, content } = parseFrontmatter(text)
    expect(parseFrontmatter(stringifyFrontmatter(content, data))).toEqual({ data, content })
  })
})
