import { Allow, parse } from 'partial-json'
import {
  JSON_RENDER_LIMITS,
  JSON_RENDER_VERSION,
  JsonRenderActionSchema,
  JsonRenderBadgeSchema,
  JsonRenderFormFieldSchema,
  JsonRenderListItemSchema,
  JsonRenderNodeSchema,
  parseJsonRenderSource,
  validateJsonRenderDocument,
  type JsonRenderAction,
  type JsonRenderBadge,
  type JsonRenderCardItem,
  type JsonRenderDocument,
  type JsonRenderFormField,
  type JsonRenderListItem,
  type JsonRenderNode,
} from './schema.js'

export type JsonRenderPartialParseResult =
  | { success: true; data: JsonRenderDocument; partial: boolean }
  | { success: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validAction = (value: unknown): value is JsonRenderAction =>
  JsonRenderActionSchema.safeParse(value).success

const validBadge = (value: unknown): value is JsonRenderBadge =>
  JsonRenderBadgeSchema.safeParse(value).success

const normalizeActions = (value: unknown): JsonRenderAction[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  const actions = value.filter(validAction)
  return actions.length ? actions : undefined
}

const hasCardItemContent = (value: Record<string, unknown>): boolean =>
  typeof value.eyebrow === 'string' ||
  validBadge(value.badge) ||
  typeof value.title === 'string' ||
  typeof value.description === 'string' ||
  (Array.isArray(value.content) && value.content.length > 0) ||
  (Array.isArray(value.actions) && value.actions.length > 0)

const normalizeCardItem = (value: unknown, depth: number): JsonRenderCardItem | null => {
  if (!isRecord(value)) {
    return null
  }
  const candidate: Record<string, unknown> = { ...value }
  if (Array.isArray(value.content)) {
    const content = value.content
      .map((child) => normalizeNode(child, depth + 1))
      .filter((child): child is JsonRenderNode => child !== null)
    if (content.length) {
      candidate.content = content
    } else {
      delete candidate.content
    }
  }
  const actions = normalizeActions(value.actions)
  if (actions) {
    candidate.actions = actions
  } else {
    delete candidate.actions
  }
  if (!hasCardItemContent(candidate)) {
    return null
  }
  const parsed = JsonRenderNodeSchema.safeParse({ type: 'Card', ...candidate })
  return parsed.success ? (candidate as JsonRenderCardItem) : null
}

const normalizeListItem = (value: unknown): JsonRenderListItem | null => {
  if (!isRecord(value)) {
    return null
  }
  const candidate: Record<string, unknown> = { ...value }
  if (value.badge !== undefined && !validBadge(value.badge)) {
    delete candidate.badge
  }
  if (value.action !== undefined && !validAction(value.action)) {
    delete candidate.action
  }
  return JsonRenderListItemSchema.safeParse(candidate).success
    ? (candidate as JsonRenderListItem)
    : null
}

const normalizeFormField = (value: unknown): JsonRenderFormField | null => {
  if (!isRecord(value)) {
    return null
  }
  const candidate: Record<string, unknown> = { ...value }
  if (Array.isArray(value.options)) {
    const validOptions = value.options.filter(
      (option) =>
        isRecord(option) &&
        typeof option.label === 'string' &&
        option.label.trim().length > 0 &&
        typeof option.value === 'string' &&
        option.value.trim().length > 0
    )
    if (validOptions.length) {
      candidate.options = validOptions
    } else {
      delete candidate.options
    }
  }
  return JsonRenderFormFieldSchema.safeParse(candidate).success
    ? (candidate as JsonRenderFormField)
    : null
}

const normalizeNode = (value: unknown, depth = 0): JsonRenderNode | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }
  if (depth > JSON_RENDER_LIMITS.maxDepth) {
    return null
  }

  if (value.type === 'Card') {
    const candidate: Record<string, unknown> = { ...value }
    const item = normalizeCardItem(value, depth)
    if (!item) {
      return null
    }
    Object.assign(candidate, item)
    delete candidate.type
    const parsed = JsonRenderNodeSchema.safeParse({ type: 'Card', ...candidate })
    return parsed.success ? parsed.data : null
  }

  if (value.type === 'Carousel') {
    if (!Array.isArray(value.items)) {
      return null
    }
    const items = value.items
      .map((item) => normalizeCardItem(item, depth + 1))
      .filter((item): item is JsonRenderCardItem => item !== null)
    return JsonRenderNodeSchema.safeParse({ ...value, items }).success
      ? JsonRenderNodeSchema.parse({ ...value, items })
      : null
  }

  if (value.type === 'List') {
    if (!Array.isArray(value.items)) {
      return null
    }
    const items = value.items
      .map(normalizeListItem)
      .filter((item): item is JsonRenderListItem => item !== null)
    return JsonRenderNodeSchema.safeParse({ ...value, items }).success
      ? JsonRenderNodeSchema.parse({ ...value, items })
      : null
  }

  if (value.type === 'Form') {
    if (!Array.isArray(value.fields)) {
      return null
    }
    const fields = value.fields
      .map(normalizeFormField)
      .filter((field): field is JsonRenderFormField => field !== null)
    return JsonRenderNodeSchema.safeParse({ ...value, fields }).success
      ? JsonRenderNodeSchema.parse({ ...value, fields })
      : null
  }

  if (
    value.type === 'Stack' ||
    value.type === 'Box' ||
    value.type === 'Row' ||
    value.type === 'Col'
  ) {
    if (!Array.isArray(value.children)) {
      return null
    }
    const children = value.children
      .map((child) => normalizeNode(child, depth + 1))
      .filter((child): child is JsonRenderNode => child !== null)
    return JsonRenderNodeSchema.safeParse({ ...value, children }).success
      ? JsonRenderNodeSchema.parse({ ...value, children })
      : null
  }

  if (value.type === 'Transition') {
    if (!Array.isArray(value.children) || value.children.length !== 1) {
      return null
    }
    const child = normalizeNode(value.children[0], depth + 1)
    return child && JsonRenderNodeSchema.safeParse({ ...value, children: [child] }).success
      ? JsonRenderNodeSchema.parse({ ...value, children: [child] })
      : null
  }

  return JsonRenderNodeSchema.safeParse(value).success ? JsonRenderNodeSchema.parse(value) : null
}

export const parsePartialJsonRenderSource = (source: string): JsonRenderPartialParseResult => {
  const complete = parseJsonRenderSource(source)
  if (complete.success) {
    return { success: true, data: complete.data, partial: false }
  }
  if (new TextEncoder().encode(source).byteLength > JSON_RENDER_LIMITS.maxDocumentBytes) {
    return { success: false, error: 'The JSON-Render document is too large' }
  }
  let parsed: unknown
  try {
    parsed = parse(source, Allow.ARR | Allow.OBJ)
  } catch {
    return { success: false, error: 'The JSON-Render document is incomplete' }
  }
  if (!isRecord(parsed) || parsed.version !== JSON_RENDER_VERSION) {
    return { success: false, error: 'The JSON-Render document is incomplete' }
  }
  const root = normalizeNode(parsed.root)
  if (!root) {
    return { success: false, error: 'The JSON-Render document is incomplete' }
  }
  const data = validateJsonRenderDocument({ version: JSON_RENDER_VERSION, root })
  if (!data.success) {
    return { success: false, error: 'The JSON-Render document is incomplete' }
  }
  return { success: true, data: data.data, partial: true }
}
