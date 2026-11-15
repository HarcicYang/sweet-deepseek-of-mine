import { z } from 'zod'

export const JSON_RENDER_VERSION = '1.0' as const
export const JSON_RENDER_LANGUAGE = 'json-render' as const

export const JSON_RENDER_LIMITS = {
  maxDocumentBytes: 64 * 1024,
  maxDepth: 8,
  maxNodes: 64,
  maxTextLength: 16 * 1024,
  maxTableColumns: 8,
  maxTableRows: 50,
  maxChartPoints: 50,
  maxChartSeries: 4,
  maxActions: 2,
  maxCarouselItems: 6,
  maxBlocksPerMessage: 4,
} as const

const text = (max = JSON_RENDER_LIMITS.maxTextLength) => z.string().max(max)
const shortText = (max: number) => z.string().trim().min(1).max(max)
const finiteNumber = z.number().finite()

export const JsonRenderActionSchema = z
  .object({
    kind: z.enum(['copy', 'prompt']),
    label: shortText(60),
    value: z.string().trim().min(1).max(4000),
  })
  .strict()

export type JsonRenderAction = z.infer<typeof JsonRenderActionSchema>
export type JsonRenderMarkdownNode = { type: 'Markdown'; value: string }
export type JsonRenderCodeNode = {
  type: 'Code'
  code: string
  language?: string
  title?: string
}
export type JsonRenderCalloutNode = {
  type: 'Callout'
  tone: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  content: JsonRenderMarkdownNode
}
export type JsonRenderTableNode = {
  type: 'Table'
  title?: string
  columns: Array<{ label: string; align?: 'left' | 'center' | 'right' }>
  rows: string[][]
}
export type JsonRenderChartNode = {
  type: 'Chart'
  kind: 'bar' | 'line'
  title?: string
  labels: string[]
  series: Array<{ name: string; values: number[] }>
  unit?: string
}
export type JsonRenderCardItem = {
  eyebrow?: string
  title?: string
  description?: string
  content: JsonRenderNode[]
  actions?: JsonRenderAction[]
}
export type JsonRenderNode =
  | JsonRenderMarkdownNode
  | JsonRenderCodeNode
  | JsonRenderCalloutNode
  | JsonRenderTableNode
  | JsonRenderChartNode
  | { type: 'Stack'; gap?: 'none' | 's' | 'm' | 'l'; children: JsonRenderNode[] }
  | ({ type: 'Card' } & JsonRenderCardItem)
  | { type: 'Carousel'; items: JsonRenderCardItem[] }

const MarkdownNodeSchema = z
  .object({
    type: z.literal('Markdown'),
    value: text(),
  })
  .strict()

const CodeNodeSchema = z
  .object({
    type: z.literal('Code'),
    code: text(),
    language: shortText(40).optional(),
    title: shortText(120).optional(),
  })
  .strict()

const CalloutNodeSchema = z
  .object({
    type: z.literal('Callout'),
    tone: z.enum(['info', 'success', 'warning', 'danger']),
    title: shortText(120).optional(),
    content: MarkdownNodeSchema,
  })
  .strict()

const TableColumnSchema = z
  .object({
    label: shortText(120),
    align: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict()

const TableNodeSchema = z
  .object({
    type: z.literal('Table'),
    title: shortText(160).optional(),
    columns: z.array(TableColumnSchema).min(1).max(JSON_RENDER_LIMITS.maxTableColumns),
    rows: z
      .array(z.array(text(1000)).min(1).max(JSON_RENDER_LIMITS.maxTableColumns))
      .max(JSON_RENDER_LIMITS.maxTableRows),
  })
  .strict()

const ChartSeriesSchema = z
  .object({
    name: shortText(80),
    values: z.array(finiteNumber).min(2).max(JSON_RENDER_LIMITS.maxChartPoints),
  })
  .strict()

const ChartNodeSchema = z
  .object({
    type: z.literal('Chart'),
    kind: z.enum(['bar', 'line']),
    title: shortText(160).optional(),
    labels: z.array(shortText(40)).min(2).max(JSON_RENDER_LIMITS.maxChartPoints),
    series: z.array(ChartSeriesSchema).min(1).max(JSON_RENDER_LIMITS.maxChartSeries),
    unit: shortText(16).optional(),
  })
  .strict()

const ActionsSchema = z.array(JsonRenderActionSchema).max(JSON_RENDER_LIMITS.maxActions)

/**
 * Recursive node union. React components are not part of this package; this schema only
 * describes serializable data accepted by the static renderer whitelist.
 */
export const JsonRenderNodeSchema: z.ZodType<JsonRenderNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    MarkdownNodeSchema,
    CodeNodeSchema,
    CalloutNodeSchema,
    TableNodeSchema,
    ChartNodeSchema,
    z
      .object({
        type: z.literal('Stack'),
        gap: z.enum(['none', 's', 'm', 'l']).optional(),
        children: z.array(JsonRenderNodeSchema).min(1).max(12),
      })
      .strict(),
    z
      .object({
        type: z.literal('Card'),
        eyebrow: shortText(40).optional(),
        title: shortText(160).optional(),
        description: text(2000).optional(),
        content: z.array(JsonRenderNodeSchema).min(1).max(8),
        actions: ActionsSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('Carousel'),
        items: z
          .array(
            z
              .object({
                eyebrow: shortText(40).optional(),
                title: shortText(160).optional(),
                description: text(1000).optional(),
                content: z.array(JsonRenderNodeSchema).min(1).max(6),
                actions: ActionsSchema.optional(),
              })
              .strict()
          )
          .min(2)
          .max(JSON_RENDER_LIMITS.maxCarouselItems),
      })
      .strict(),
  ])
) as z.ZodType<JsonRenderNode>

export const JsonRenderDocumentSchema = z
  .object({
    version: z.literal(JSON_RENDER_VERSION),
    root: JsonRenderNodeSchema,
  })
  .strict()

export type JsonRenderDocument = z.infer<typeof JsonRenderDocumentSchema>

export const JsonRenderValidationRequestSchema = z
  .object({
    source: z.string().min(1).max(JSON_RENDER_LIMITS.maxDocumentBytes),
  })
  .strict()

export type JsonRenderValidationRequest = z.infer<typeof JsonRenderValidationRequestSchema>

export const JsonRenderValidationResponseSchema = z
  .object({
    document: JsonRenderDocumentSchema,
  })
  .strict()

export type JsonRenderValidationResponse = z.infer<typeof JsonRenderValidationResponseSchema>

export type JsonRenderValidationResult =
  | { success: true; data: JsonRenderDocument }
  | { success: false; error: string }

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const validateStructuralLimits = (document: JsonRenderDocument): string | null => {
  let nodeCount = 0

  const visit = (node: JsonRenderNode, depth: number): string | null => {
    nodeCount += 1
    if (nodeCount > JSON_RENDER_LIMITS.maxNodes) {
      return 'The document contains too many nodes'
    }
    if (depth > JSON_RENDER_LIMITS.maxDepth) {
      return 'The document is nested too deeply'
    }

    if (node.type === 'Table') {
      if (node.rows.some((row) => row.length !== node.columns.length)) {
        return 'Every table row must match the column count'
      }
      return null
    }
    if (node.type === 'Chart') {
      if (node.series.some((series) => series.values.length !== node.labels.length)) {
        return 'Every chart series must match the label count'
      }
      return null
    }
    if (node.type === 'Stack') {
      for (const child of node.children) {
        const error = visit(child, depth + 1)
        if (error) {
          return error
        }
      }
      return null
    }
    if (node.type === 'Card') {
      for (const child of node.content) {
        const error = visit(child, depth + 1)
        if (error) {
          return error
        }
      }
      return null
    }
    if (node.type === 'Carousel') {
      for (const item of node.items) {
        nodeCount += 1
        if (nodeCount > JSON_RENDER_LIMITS.maxNodes) {
          return 'The document contains too many nodes'
        }
        for (const child of item.content) {
          const error = visit(child, depth + 2)
          if (error) {
            return error
          }
        }
      }
    }
    return null
  }

  return visit(document.root, 1)
}

export const validateJsonRenderDocument = (input: unknown): JsonRenderValidationResult => {
  const parsed = JsonRenderDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: 'The document does not match the JSON-Render schema' }
  }
  const structuralError = validateStructuralLimits(parsed.data)
  if (structuralError) {
    return { success: false, error: structuralError }
  }
  return { success: true, data: parsed.data }
}

export const parseJsonRenderSource = (source: string): JsonRenderValidationResult => {
  if (utf8Length(source) > JSON_RENDER_LIMITS.maxDocumentBytes) {
    return { success: false, error: 'The JSON-Render document is too large' }
  }
  try {
    return validateJsonRenderDocument(JSON.parse(source) as unknown)
  } catch {
    return { success: false, error: 'The JSON-Render block is not valid JSON' }
  }
}
