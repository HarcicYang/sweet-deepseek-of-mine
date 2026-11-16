import { z } from 'zod'

export const JSON_RENDER_VERSION = '1.0' as const
export const JSON_RENDER_LANGUAGE = 'json-render' as const

export const JSON_RENDER_LIMITS = {
  maxDocumentBytes: 64 * 1024,
  maxDepth: 8,
  maxNodes: 64,
  maxTextLength: 16 * 1024,
  maxChartPoints: 50,
  maxChartSeries: 4,
  maxActions: 2,
  maxCarouselItems: 6,
  maxListItems: 8,
  maxFormFields: 6,
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
export type JsonRenderBadgeColor =
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'discovery'
export type JsonRenderBadge = {
  label: string
  color?: JsonRenderBadgeColor
  variant?: 'solid' | 'soft' | 'outline'
  pill?: boolean
}
export type JsonRenderBadgeNode = JsonRenderBadge & { type: 'Badge' }
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
export type JsonRenderChartNode = {
  type: 'Chart'
  kind: 'bar' | 'line'
  title?: string
  labels: string[]
  series: Array<{ name: string; values: number[] }>
  unit?: string
}
export type JsonRenderStatsNode = {
  type: 'Stats'
  items: Array<{ label: string; value: string; detail?: string }>
}
export type JsonRenderStepsNode = {
  type: 'Steps'
  items: Array<{
    title: string
    description?: JsonRenderMarkdownNode
    status: 'pending' | 'active' | 'done' | 'error'
  }>
}
export type JsonRenderDetailsNode = {
  type: 'Details'
  title: string
  content: JsonRenderMarkdownNode
  open?: boolean
}
export type JsonRenderListItem = {
  title: string
  description?: string
  meta?: string
  badge?: JsonRenderBadge
  action?: JsonRenderAction
}
export type JsonRenderListNode = {
  type: 'List'
  title?: string
  items: JsonRenderListItem[]
}
export type JsonRenderImageNode = {
  type: 'Image'
  src: string
  alt: string
  caption?: string
  aspectRatio?: 'auto' | 'landscape' | 'square' | 'portrait'
  fit?: 'cover' | 'contain'
}
export type JsonRenderFormField = {
  type: 'text' | 'textarea' | 'select'
  name: string
  label: string
  placeholder?: string
  description?: string
  required?: boolean
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}
export type JsonRenderFormNode = {
  type: 'Form'
  title?: string
  description?: string
  fields: JsonRenderFormField[]
  submitLabel: string
  promptTemplate: string
}
export type JsonRenderCardItem = {
  eyebrow?: string
  badge?: JsonRenderBadge
  title?: string
  description?: string
  content?: JsonRenderNode[]
  actions?: JsonRenderAction[]
}
export type JsonRenderNode =
  | JsonRenderMarkdownNode
  | JsonRenderCodeNode
  | JsonRenderCalloutNode
  | JsonRenderChartNode
  | JsonRenderStatsNode
  | JsonRenderStepsNode
  | JsonRenderDetailsNode
  | JsonRenderBadgeNode
  | JsonRenderListNode
  | JsonRenderImageNode
  | JsonRenderFormNode
  | { type: 'Stack'; gap?: 'none' | 's' | 'm' | 'l'; children: JsonRenderNode[] }
  | ({ type: 'Card' } & JsonRenderCardItem)
  | { type: 'Carousel'; items: JsonRenderCardItem[] }

const MarkdownNodeSchema = z
  .object({
    type: z.literal('Markdown'),
    value: text(),
  })
  .strict()

const BadgeSchema = z
  .object({
    label: shortText(80),
    color: z.enum(['secondary', 'success', 'danger', 'warning', 'info', 'discovery']).optional(),
    variant: z.enum(['solid', 'soft', 'outline']).optional(),
    pill: z.boolean().optional(),
  })
  .strict()

const BadgeNodeSchema = z
  .object({
    type: z.literal('Badge'),
    label: shortText(80),
    color: z.enum(['secondary', 'success', 'danger', 'warning', 'info', 'discovery']).optional(),
    variant: z.enum(['solid', 'soft', 'outline']).optional(),
    pill: z.boolean().optional(),
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

const StatsNodeSchema = z
  .object({
    type: z.literal('Stats'),
    items: z
      .array(
        z
          .object({
            label: shortText(80),
            value: shortText(48),
            detail: shortText(160).optional(),
          })
          .strict()
      )
      .min(2)
      .max(4),
  })
  .strict()

const StepsNodeSchema = z
  .object({
    type: z.literal('Steps'),
    items: z
      .array(
        z
          .object({
            title: shortText(120),
            description: MarkdownNodeSchema.optional(),
            status: z.enum(['pending', 'active', 'done', 'error']),
          })
          .strict()
      )
      .min(2)
      .max(8),
  })
  .strict()

const DetailsNodeSchema = z
  .object({
    type: z.literal('Details'),
    title: shortText(160),
    content: MarkdownNodeSchema,
    open: z.boolean().optional(),
  })
  .strict()

const ListItemSchema = z
  .object({
    title: shortText(160),
    description: text(2000).optional(),
    meta: shortText(80).optional(),
    badge: BadgeSchema.optional(),
    action: JsonRenderActionSchema.optional(),
  })
  .strict()

const ListNodeSchema = z
  .object({
    type: z.literal('List'),
    title: shortText(160).optional(),
    items: z.array(ListItemSchema).min(2).max(JSON_RENDER_LIMITS.maxListItems),
  })
  .strict()

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
    } catch {
      return false
    }
  }, 'Image src must be an HTTPS URL')

const ImageNodeSchema = z
  .object({
    type: z.literal('Image'),
    src: httpsUrl,
    alt: shortText(500),
    caption: shortText(500).optional(),
    aspectRatio: z.enum(['auto', 'landscape', 'square', 'portrait']).optional(),
    fit: z.enum(['cover', 'contain']).optional(),
  })
  .strict()

const FormFieldCommonSchema = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/u, 'Field names must be identifiers'),
  label: shortText(120),
  placeholder: shortText(160).optional(),
  description: shortText(500).optional(),
  required: z.boolean().optional(),
  defaultValue: shortText(2000).optional(),
} as const

const FormFieldSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      ...FormFieldCommonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('textarea'),
      ...FormFieldCommonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('select'),
      ...FormFieldCommonSchema,
      options: z
        .array(
          z
            .object({
              label: shortText(80),
              value: shortText(80),
            })
            .strict()
        )
        .min(2)
        .max(8),
    })
    .strict()
    .superRefine((field, context) => {
      if (
        field.defaultValue !== undefined &&
        !field.options.some((option) => option.value === field.defaultValue)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select defaultValue must match an option value',
        })
      }
    }),
])

const FormNodeSchema = z
  .object({
    type: z.literal('Form'),
    title: shortText(160).optional(),
    description: text(2000).optional(),
    fields: z.array(FormFieldSchema).min(1).max(JSON_RENDER_LIMITS.maxFormFields),
    submitLabel: shortText(60),
    promptTemplate: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine((form, context) => {
    const names = new Set(form.fields.map((field) => field.name))
    if (names.size !== form.fields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Form field names must be unique',
      })
    }
    for (const match of form.promptTemplate.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/gu)) {
      if (!names.has(match[1])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown form placeholder: ${match[1]}`,
        })
      }
    }
  })

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
    ChartNodeSchema,
    StatsNodeSchema,
    StepsNodeSchema,
    DetailsNodeSchema,
    BadgeNodeSchema,
    ListNodeSchema,
    ImageNodeSchema,
    FormNodeSchema,
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
        badge: BadgeSchema.optional(),
        title: shortText(160).optional(),
        description: text(2000).optional(),
        content: z.array(JsonRenderNodeSchema).min(1).max(8).optional(),
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
                badge: BadgeSchema.optional(),
                title: shortText(160).optional(),
                description: text(1000).optional(),
                content: z.array(JsonRenderNodeSchema).min(1).max(6).optional(),
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
      if (node.badge) {
        nodeCount += 1
        if (nodeCount > JSON_RENDER_LIMITS.maxNodes) {
          return 'The document contains too many nodes'
        }
      }
      for (const child of node.content ?? []) {
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
        if (item.badge) {
          nodeCount += 1
        }
        if (nodeCount > JSON_RENDER_LIMITS.maxNodes) {
          return 'The document contains too many nodes'
        }
        for (const child of item.content ?? []) {
          const error = visit(child, depth + 2)
          if (error) {
            return error
          }
        }
      }
      return null
    }
    if (node.type === 'List') {
      nodeCount += node.items.length
      for (const item of node.items) {
        if (item.badge) {
          nodeCount += 1
        }
      }
      if (nodeCount > JSON_RENDER_LIMITS.maxNodes) {
        return 'The document contains too many nodes'
      }
      return null
    }
    if (node.type === 'Form') {
      nodeCount += node.fields.length
      if (nodeCount > JSON_RENDER_LIMITS.maxNodes) {
        return 'The document contains too many nodes'
      }
      return null
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
