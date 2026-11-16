import assert from 'node:assert/strict'
import test from 'node:test'
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

test('validates stats, steps, and details blocks', () => {
  const result = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Stack',
      children: [
        {
          type: 'Stats',
          items: [
            { label: 'Latency', value: '18 ms', detail: 'Tokyo edge' },
            { label: 'Throughput', value: '72 tok/s' },
          ],
        },
        {
          type: 'Steps',
          items: [
            { title: 'Measure', status: 'done' },
            {
              title: 'Compare',
              status: 'active',
              description: { type: 'Markdown', value: 'Run both paths.' },
            },
          ],
        },
        {
          type: 'Details',
          title: 'Method',
          open: false,
          content: { type: 'Markdown', value: 'Five samples per region.' },
        },
      ],
    },
  })
  assert.equal(result.success, true)
})

test('validates badge and list blocks with one action per row', () => {
  const result = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'List',
      title: 'Deployment options',
      items: [
        {
          title: 'Cloudflare Workers',
          description: 'Serverless edge deployment with D1 persistence.',
          meta: 'Free tier',
          badge: { label: 'Recommended', color: 'success', variant: 'soft' },
          action: { kind: 'prompt', label: 'Compare', value: 'Compare the deployment options.' },
        },
        {
          title: 'Node on ECS or a PC',
          description: 'Run the same server outside the edge.',
          badge: { label: 'Portable', color: 'info', variant: 'outline', pill: true },
          action: { kind: 'copy', label: 'Copy', value: 'node server.js' },
        },
      ],
    },
  })
  assert.equal(result.success, true)
})

test('accepts card and carousel items without nested content', () => {
  const result = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Stack',
      gap: 'm',
      children: [
        {
          type: 'Card',
          eyebrow: 'Card',
          title: '卡片标题',
          description: '一句话说明这张卡片解决什么问题。',
          actions: [
            { kind: 'prompt', label: '继续追问', value: '请详细解释这个卡片的用法' },
            { kind: 'copy', label: '复制要点', value: '卡片可承载标题和说明。' },
          ],
        },
        {
          type: 'Carousel',
          items: [
            {
              eyebrow: '方案 A',
              title: '轮播项一',
              description: '适合并列方案或分步内容。',
              actions: [{ kind: 'prompt', label: '选择方案 A', value: '继续说明方案 A' }],
            },
            { eyebrow: '方案 B', title: '轮播项二', description: '左右滑动查看其他项。' },
          ],
        },
      ],
    },
  })
  assert.equal(result.success, true)
})

test('validates image and prompt-backed form blocks', () => {
  const result = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Stack',
      children: [
        {
          type: 'Image',
          src: 'https://images.example.com/architecture.webp',
          alt: 'Deployment architecture diagram',
          caption: 'Edge and Node adapters share the same API.',
          aspectRatio: 'landscape',
          fit: 'cover',
        },
        {
          type: 'Form',
          title: 'Tune the recommendation',
          fields: [
            {
              type: 'select',
              name: 'environment',
              label: 'Environment',
              options: [
                { label: 'Workers', value: 'workers' },
                { label: 'Node', value: 'node' },
              ],
              defaultValue: 'workers',
              required: true,
            },
            {
              type: 'textarea',
              name: 'goal',
              label: 'Goal',
              placeholder: 'What should the deployment optimize for?',
            },
          ],
          submitLabel: 'Continue',
          promptTemplate: 'Compare {{environment}} deployment for {{goal}}.',
        },
      ],
    },
  })
  assert.equal(result.success, true)
})

test('rejects insecure images and unknown form placeholders', () => {
  const insecureImage = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Image',
      src: 'http://images.example.com/architecture.png',
      alt: 'Architecture',
    },
  })
  assert.equal(insecureImage.success, false)

  const form = validateJsonRenderDocument({
    version: '1.0',
    root: {
      type: 'Form',
      fields: [{ type: 'text', name: 'goal', label: 'Goal' }],
      submitLabel: 'Continue',
      promptTemplate: 'Continue with {{unknown}}.',
    },
  })
  assert.equal(form.success, false)
})

test('rejects unknown node properties and types', () => {
  const result = validateJsonRenderDocument({
    version: '1.0',
    root: { type: 'Markdown', value: 'ok', className: 'attacker' },
  })
  assert.equal(result.success, false)
})

test('rejects chart shape mismatches', () => {
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
