import { JSON_RENDER_LANGUAGE, JSON_RENDER_LIMITS } from './schema.js'

export type JsonRenderSegment =
  | { type: 'markdown'; content: string }
  | { type: 'json-render'; source: string }
  | { type: 'pending'; source: string }

export type LimitedJsonRenderSegment = {
  segment: JsonRenderSegment
  limited: boolean
}

type MarkdownLine = {
  text: string
  start: number
  nextStart: number
}

type Fence = {
  marker: '`' | '~'
  length: number
  info: string
}

const scanLines = (content: string): MarkdownLine[] => {
  const lines: MarkdownLine[] = []
  let start = 0
  while (start < content.length) {
    const newline = content.indexOf('\n', start)
    if (newline === -1) {
      lines.push({ text: content.slice(start), start, nextStart: content.length })
      break
    }
    const end = newline > start && content.charAt(newline - 1) === '\r' ? newline - 1 : newline
    lines.push({ text: content.slice(start, end), start, nextStart: newline + 1 })
    start = newline + 1
  }
  return lines
}

const parseFence = (line: string): Fence | null => {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line)
  if (!match) {
    return null
  }
  const marker = match[2]?.charAt(0)
  const length = match[2]?.length ?? 0
  const suffix = match[3] ?? ''
  if ((marker !== '`' && marker !== '~') || (marker === '`' && suffix.includes('`'))) {
    return null
  }
  return { marker, length, info: suffix.trim() }
}

const isClosingFence = (line: string, opening: Fence): boolean => {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line)
  if (!match) {
    return false
  }
  const marker = match[1]?.charAt(0)
  return marker === opening.marker && (match[1]?.length ?? 0) >= opening.length
}

const isJsonRenderFence = (fence: Fence): boolean =>
  fence.marker === '`' && fence.info === JSON_RENDER_LANGUAGE

const partialJsonRenderFence = (line: string): boolean => {
  const match = /^( {0,3})(`{3,})(.*)$/u.exec(line)
  if (!match || match[2]?.length !== 3) {
    return false
  }
  const suffix = match[3]?.trim() ?? ''
  return JSON_RENDER_LANGUAGE.startsWith(suffix)
}

const appendMarkdown = (segments: JsonRenderSegment[], content: string) => {
  if (!content) {
    return
  }
  const previous = segments.at(-1)
  if (previous?.type === 'markdown') {
    previous.content += content
  } else {
    segments.push({ type: 'markdown', content })
  }
}

const findClosingLine = (
  lines: MarkdownLine[],
  startIndex: number,
  opening: Fence
): number | null => {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (isClosingFence(lines[index]?.text ?? '', opening)) {
      return index
    }
  }
  return null
}

/**
 * Split a Markdown answer into normal text and complete json-render fenced blocks.
 * Other Markdown code fences are skipped as a whole, so examples containing the
 * json-render marker retain their original Markdown behavior.
 */
export const extractJsonRenderSegments = (
  content: string,
  { final = false }: { final?: boolean } = {}
): JsonRenderSegment[] => {
  const segments: JsonRenderSegment[] = []
  const lines = scanLines(content)
  let cursor = 0
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    if (!line) {
      break
    }
    const fence = parseFence(line.text)
    if (!fence) {
      lineIndex += 1
      continue
    }
    const closeIndex = findClosingLine(lines, lineIndex + 1, fence)

    if (!isJsonRenderFence(fence)) {
      if (closeIndex === null) {
        appendMarkdown(segments, content.slice(cursor))
        return segments
      }
      lineIndex = closeIndex + 1
      continue
    }

    appendMarkdown(segments, content.slice(cursor, line.start))
    const sourceStart = line.nextStart
    if (closeIndex === null) {
      if (final) {
        appendMarkdown(segments, content.slice(line.start))
      } else {
        segments.push({ type: 'pending', source: content.slice(sourceStart) })
      }
      return segments
    }

    const closeLine = lines[closeIndex]
    if (!closeLine) {
      return segments
    }
    segments.push({
      type: 'json-render',
      source: content.slice(sourceStart, closeLine.start).trim(),
    })
    cursor = closeLine.nextStart
    lineIndex = closeIndex + 1
  }

  const tailStart = content.lastIndexOf('\n') + 1
  const tail = content.slice(tailStart).replace(/\r$/u, '')
  if (!final && tailStart >= cursor && partialJsonRenderFence(tail)) {
    appendMarkdown(segments, content.slice(cursor, tailStart))
    segments.push({ type: 'pending', source: tail })
  } else {
    appendMarkdown(segments, content.slice(cursor))
  }
  return segments
}

/** Keep rendering bounded while preserving excess content as a visible fallback. */
export const markExcessJsonRenderSegments = (
  segments: JsonRenderSegment[],
  maxBlocks: number = JSON_RENDER_LIMITS.maxBlocksPerMessage
): LimitedJsonRenderSegment[] => {
  let renderBlocks = 0
  return segments.map((segment) => {
    if (segment.type !== 'json-render') {
      return { segment, limited: false }
    }
    renderBlocks += 1
    return { segment, limited: renderBlocks > maxBlocks }
  })
}

/** Text suitable for copy/read-aloud: complete widgets are omitted, not exposed as raw JSON. */
export const stripJsonRenderBlocks = (content: string): string =>
  extractJsonRenderSegments(content, { final: true })
    .filter((segment): segment is { type: 'markdown'; content: string } => segment.type === 'markdown')
    .map((segment) => segment.content)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
