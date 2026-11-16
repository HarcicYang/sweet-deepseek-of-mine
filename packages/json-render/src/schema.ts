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
  maxLayoutChildren: 12,
  maxSelectOptions: 12,
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
export type JsonRenderGap = 'none' | 's' | 'm' | 'l' | 'xl'
export type JsonRenderLayoutAlign = 'start' | 'center' | 'end' | 'stretch'
export type JsonRenderLayoutJustify = 'start' | 'center' | 'end' | 'between'
export type JsonRenderPadding = 'none' | 's' | 'm' | 'l'
export type JsonRenderSurface = 'none' | 'layer' | 'subtle'
export type JsonRenderRadius = 'none' | 's' | 'm' | 'l'
export type JsonRenderIconName =
  | 'check'
  | 'close'
  | 'copy'
  | 'download'
  | 'edit'
  | 'expand'
  | 'link'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'upload'
  | 'warning'
export type JsonRenderIconColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
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
export type JsonRenderDividerNode = {
  type: 'Divider'
  orientation?: 'horizontal' | 'vertical'
  spacing?: JsonRenderGap
}
export type JsonRenderIconNode = {
  type: 'Icon'
  name: JsonRenderIconName
  label?: string
  color?: JsonRenderIconColor
  size?: 's' | 'm' | 'l'
}
export type JsonRenderSpacerNode = {
  type: 'Spacer'
  size?: 's' | 'm' | 'l' | 'xl'
  grow?: boolean
}
export type JsonRenderSelectOption = { label: string; value: string }
export type JsonRenderSelectNode = {
  type: 'Select'
  label: string
  placeholder?: string
  defaultValue?: string
  options: JsonRenderSelectOption[]
  promptTemplate: string
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
  type: 'text' | 'textarea' | 'select' | 'date'
  name: string
  label: string
  placeholder?: string
  description?: string
  required?: boolean
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
  min?: string
  max?: string
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
type JsonRenderLayoutProps = {
  gap?: JsonRenderGap
  align?: JsonRenderLayoutAlign
  justify?: JsonRenderLayoutJustify
  wrap?: boolean
  grow?: boolean
  padding?: JsonRenderPadding
  background?: JsonRenderSurface
  radius?: JsonRenderRadius
}
export type JsonRenderBoxNode = JsonRenderLayoutProps & {
  type: 'Box'
  direction: 'row' | 'column'
  children: JsonRenderNode[]
}
export type JsonRenderRowNode = JsonRenderLayoutProps & {
  type: 'Row'
  children: JsonRenderNode[]
}
export type JsonRenderColNode = JsonRenderLayoutProps & {
  type: 'Col'
  children: JsonRenderNode[]
}
export type JsonRenderTransitionNode = {
  type: 'Transition'
  effect?: 'fade' | 'slide-up' | 'scale'
  grow?: boolean
  children: [JsonRenderNode]
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
  | JsonRenderDividerNode
  | JsonRenderIconNode
  | JsonRenderSpacerNode
  | JsonRenderSelectNode
  | JsonRenderBoxNode
  | JsonRenderRowNode
  | JsonRenderColNode
  | JsonRenderTransitionNode
  | { type: 'Stack'; gap?: 'none' | 's' | 'm' | 'l'; children: JsonRenderNode[] }
  | ({ type: 'Card' } & JsonRenderCardItem)
  | { type: 'Carousel'; items: JsonRenderCardItem[] }

const MarkdownNodeSchema = z
  .object({
    type: z.literal('Markdown'),
    value: text(),
  })
  .strict()

export const JsonRenderBadgeSchema = z
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

export const JsonRenderListItemSchema = z
  .object({
    title: shortText(160),
    description: text(2000).optional(),
    meta: shortText(80).optional(),
    badge: JsonRenderBadgeSchema.optional(),
    action: JsonRenderActionSchema.optional(),
  })
  .strict()

const ListNodeSchema = z
  .object({
    type: z.literal('List'),
    title: shortText(160).optional(),
    items: z.array(JsonRenderListItemSchema).min(2).max(JSON_RENDER_LIMITS.maxListItems),
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

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)

export const JsonRenderFormFieldSchema = z.discriminatedUnion('type', [
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
  z
    .object({
      type: z.literal('date'),
      ...FormFieldCommonSchema,
      min: dateString.optional(),
      max: dateString.optional(),
    })
    .strict()
    .superRefine((field, context) => {
      if (field.defaultValue !== undefined && !dateString.safeParse(field.defaultValue).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Date defaultValue must use YYYY-MM-DD',
        })
      }
    }),
])

const IconNameSchema = z.enum([
  'check',
  'close',
  'copy',
  'download',
  'edit',
  'expand',
  'link',
  'refresh',
  'search',
  'settings',
  'upload',
  'warning',
])

const DividerNodeSchema = z
  .object({
    type: z.literal('Divider'),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
    spacing: z.enum(['none', 's', 'm', 'l', 'xl']).optional(),
  })
  .strict()

const IconNodeSchema = z
  .object({
    type: z.literal('Icon'),
    name: IconNameSchema,
    label: shortText(120).optional(),
    color: z
      .enum(['primary', 'secondary', 'tertiary', 'brand', 'success', 'warning', 'danger'])
      .optional(),
    size: z.enum(['s', 'm', 'l']).optional(),
  })
  .strict()

const SpacerNodeSchema = z
  .object({
    type: z.literal('Spacer'),
    size: z.enum(['s', 'm', 'l', 'xl']).optional(),
    grow: z.boolean().optional(),
  })
  .strict()

const SelectNodeSchema = z
  .object({
    type: z.literal('Select'),
    label: shortText(160),
    placeholder: shortText(160).optional(),
    defaultValue: shortText(80).optional(),
    options: z
      .array(z.object({ label: shortText(80), value: shortText(80) }).strict())
      .min(2)
      .max(JSON_RENDER_LIMITS.maxSelectOptions),
    promptTemplate: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine((select, context) => {
    const values = new Set(select.options.map((option) => option.value))
    if (select.defaultValue !== undefined && !values.has(select.defaultValue)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select defaultValue must match an option value',
      })
    }
    for (const match of select.promptTemplate.matchAll(/\{\{([^{}]+)\}\}/gu)) {
      if (match[1] !== 'value' && match[1] !== 'label') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select promptTemplate only supports {{value}} and {{label}}',
        })
      }
    }
  })

const FormNodeSchema = z
  .object({
    type: z.literal('Form'),
    title: shortText(160).optional(),
    description: text(2000).optional(),
    fields: z.array(JsonRenderFormFieldSchema).min(1).max(JSON_RENDER_LIMITS.maxFormFields),
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

const layoutProps = {
  gap: z.enum(['none', 's', 'm', 'l', 'xl']).optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  justify: z.enum(['start', 'center', 'end', 'between']).optional(),
  wrap: z.boolean().optional(),
  grow: z.boolean().optional(),
  padding: z.enum(['none', 's', 'm', 'l']).optional(),
  background: z.enum(['none', 'layer', 'subtle']).optional(),
  radius: z.enum(['none', 's', 'm', 'l']).optional(),
} as const

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
    DividerNodeSchema,
    IconNodeSchema,
    SpacerNodeSchema,
    SelectNodeSchema,
    z
      .object({
        type: z.literal('Stack'),
        gap: z.enum(['none', 's', 'm', 'l']).optional(),
        children: z.array(JsonRenderNodeSchema).min(1).max(JSON_RENDER_LIMITS.maxLayoutChildren),
      })
      .strict(),
    z
      .object({
        type: z.literal('Box'),
        direction: z.enum(['row', 'column']),
        ...layoutProps,
        children: z.array(JsonRenderNodeSchema).min(1).max(JSON_RENDER_LIMITS.maxLayoutChildren),
      })
      .strict(),
    z
      .object({
        type: z.literal('Row'),
        ...layoutProps,
        children: z.array(JsonRenderNodeSchema).min(1).max(JSON_RENDER_LIMITS.maxLayoutChildren),
      })
      .strict(),
    z
      .object({
        type: z.literal('Col'),
        ...layoutProps,
        children: z.array(JsonRenderNodeSchema).min(1).max(JSON_RENDER_LIMITS.maxLayoutChildren),
      })
      .strict(),
    z
      .object({
        type: z.literal('Transition'),
        effect: z.enum(['fade', 'slide-up', 'scale']).optional(),
        grow: z.boolean().optional(),
        children: z.array(JsonRenderNodeSchema).length(1),
      })
      .strict(),
    z
      .object({
        type: z.literal('Card'),
        eyebrow: shortText(40).optional(),
        badge: JsonRenderBadgeSchema.optional(),
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
                badge: JsonRenderBadgeSchema.optional(),
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
    if (node.type === 'Box' || node.type === 'Row' || node.type === 'Col') {
      for (const child of node.children) {
        const error = visit(child, depth + 1)
        if (error) {
          return error
        }
      }
      return null
    }
    if (node.type === 'Transition') {
      return visit(node.children[0], depth + 1)
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
