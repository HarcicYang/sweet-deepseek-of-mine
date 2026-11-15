import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractJsonRenderSegments,
  markExcessJsonRenderSegments,
  stripJsonRenderBlocks,
} from './extract.js'
import { JSON_RENDER_LIMITS, parseJsonRenderSource, validateJsonRenderDocument } from './schema.js'

const validDocument = {
  version: '1.0',
  root: {
    type: 'Stack',
    gap: 'm',
    children: [
      {
        type: 'Callout',
        tone: 'info',
        title: 'Summary',
        content: { type: 'Markdown', value: 'Hello **world**.' },
      },
      {
        type: 'Card',
        title: 'Next step',
        content: [{ type: 'Markdown', value: 'Choose an option.' }],
        actions: [{ kind: 'prompt', label: 'Continue', value: 'Continue the analysis' }],
      },
    ],
  },
}

test('validates a supported JSON-Render document', () => {
  const result = validateJsonRenderDocument(validDocument)
  assert.equal(result.success, true)
})

test('rejects unknown node properties and types', () => {
  const result = validateJsonRenderDocument({
    version: '1.0',
    root: { type: 'Markdown', value: 'ok', className: 'attacker' },
  })
  assert.equal(result.success, false)
})

test('rejects table and chart shape mismatches', () => {
  const table = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Table',
      columns: [{ label: 'A' }, { label: 'B' }],
      rows: [['only one cell']],
    },
  })
  assert.equal(table.success, false)

  const chart = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Chart',
      kind: 'line',
      labels: ['A', 'B'],
      series: [{ name: 'S', values: [1] }],
    },
  })
  assert.equal(chart.success, false)
})

test('rejects excessive nesting and more than two actions', () => {
  let root: Record<string, unknown> = { type: 'Markdown', value: 'leaf' }
  for (let depth = 0; depth < JSON_RENDER_LIMITS.maxDepth + 1; depth += 1) {
    root = { type: 'Stack', children: [root] }
  }
  assert.equal(validateJsonRenderDocument({ version: '1.0', root }).success, false)

  const actions = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Card',
      content: [{ type: 'Markdown', value: 'body' }],
      actions: [
        { kind: 'copy', label: 'One', value: '1' },
        { kind: 'copy', label: 'Two', value: '2' },
        { kind: 'copy', label: 'Three', value: '3' },
      ],
    },
  })
  assert.equal(actions.success, false)
})

test('enforces the document byte limit before JSON parsing', () => {
  const result = parseJsonRenderSource(' '.repeat(JSON_RENDER_LIMITS.maxDocumentBytes + 1))
  assert.equal(result.success, false)
})

test('extracts complete blocks and hides unfinished streaming JSON', () => {
  const complete = 'Before\n\n```json-render\n{"version":"1.0"}\n```\n\nAfter'
  assert.deepEqual(extractJsonRenderSegments(complete, { final: true }), [
    { type: 'markdown', content: 'Before\n\n' },
    { type: 'json-render', source: '{"version":"1.0"}' },
    { type: 'markdown', content: '\nAfter' },
  ])

  const streaming = 'Before\n\n```json-render\n{"version":'
  const segments = extractJsonRenderSegments(streaming)
  assert.deepEqual(segments, [
    { type: 'markdown', content: 'Before\n\n' },
    { type: 'pending', source: '{"version":' },
  ])

  assert.deepEqual(extractJsonRenderSegments(streaming, { final: true }), [
    { type: 'markdown', content: streaming },
  ])
})

test('preserves interleaved text and multiple complete interface blocks', () => {
  const content = [
    'Intro',
    '```json-render',
    '{"version":"1.0","root":{"type":"Markdown","value":"one"}}',
    '```',
    'Between',
    '```json-render',
    '{"version":"1.0","root":{"type":"Markdown","value":"two"}}',
    '```',
    'Outro',
  ].join('\n')
  assert.deepEqual(extractJsonRenderSegments(content, { final: true }), [
    { type: 'markdown', content: 'Intro\n' },
    {
      type: 'json-render',
      source: '{"version":"1.0","root":{"type":"Markdown","value":"one"}}',
    },
    { type: 'markdown', content: 'Between\n' },
    {
      type: 'json-render',
      source: '{"version":"1.0","root":{"type":"Markdown","value":"two"}}',
    },
    { type: 'markdown', content: 'Outro' },
  ])
})

test('does not interpret json-render examples inside ordinary code fences', () => {
  const content = [
    'Example:',
    '````markdown',
    '```json-render',
    '{"version":"1.0"}',
    '```',
    '````',
    '',
    'After',
  ].join('\n')
  assert.deepEqual(extractJsonRenderSegments(content, { final: true }), [
    { type: 'markdown', content },
  ])
})

test('marks interface blocks beyond the per-message limit', () => {
  const block = { type: 'json-render' as const, source: '{"version":"1.0"}' }
  const limited = markExcessJsonRenderSegments([block, block, block], 2)
  assert.deepEqual(
    limited.map(({ limited }) => limited),
    [false, false, true]
  )
})

test('strips widget JSON from copy text', () => {
  assert.equal(
    stripJsonRenderBlocks('Intro\n```json-render\n{"version":"1.0"}\n```\nOutro'),
    'Intro\nOutro'
  )
})
