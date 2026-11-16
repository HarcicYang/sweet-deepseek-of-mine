import type { Nodes, Parent } from 'mdast'
import { JSON_RENDER_LANGUAGE } from '@sweet-deepseek/json-render'
import { toMdAst } from './parse.js'

type SourceRange = { start: number; end: number }

const collectRanges = (node: Nodes, ranges: SourceRange[]) => {
  if (
    node.type === 'code' &&
    node.lang === JSON_RENDER_LANGUAGE &&
    node.position?.start.offset !== undefined &&
    node.position.end.offset !== undefined
  ) {
    ranges.push({ start: node.position.start.offset, end: node.position.end.offset })
  }
  if ('children' in node) {
    for (const child of (node as Parent).children) {
      collectRanges(child, ranges)
    }
  }
}

/** Remove JSON-Render code nodes using the same mdast parser used for display. */
export const stripJsonRenderCodeBlocks = (input: string): string => {
  const ast = toMdAst(input, { disableLink: false, sources: undefined })
  const ranges: SourceRange[] = []
  collectRanges(ast, ranges)
  if (ranges.length === 0) {
    return input.trim()
  }
  ranges.sort((left, right) => left.start - right.start)
  let cursor = 0
  let output = ''
  for (const range of ranges) {
    output += input.slice(cursor, range.start)
    cursor = range.end
  }
  output += input.slice(cursor)
  return output.replace(/\n{3,}/g, '\n\n').trim()
}
