import { z } from 'zod'

export const SYNC_SCHEMA_VERSION = 1

const JsonObjectSchema = z.record(z.string(), z.unknown())

const TextCitationSchema = z
  .object({
    type: z.literal('web_search_result_location'),
    url: z.string().url(),
    title: z.string().nullable(),
    cited_text: z.string(),
    encrypted_index: z.string(),
  })
  .strict()

const FileAttachmentSchema = z
  .object({
    id: z.string().min(1).max(200),
    serverId: z.string().nullable(),
    name: z.string().max(1000),
    size: z.number().int().nonnegative(),
    isImage: z.boolean(),
    mimeType: z.string().max(500),
  })
  .strict()

const MessageBranchSchema = {
  parentId: z.string().nullable().optional(),
  selectedChildId: z.string().optional(),
}

const UserMessageSchema = z
  .object({
    id: z.string().min(1).max(200),
    role: z.literal('user'),
    content: z.string().max(2_000_000),
    files: z.array(FileAttachmentSchema).max(200),
    createdAt: z.number().int().nonnegative(),
    ...MessageBranchSchema,
  })
  .strict()

const ThinkingPartSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
    elapsedSeconds: z.number().nonnegative().optional(),
  })
  .strict()

const TextPartSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    citations: z.array(TextCitationSchema).optional(),
    isTemplate: z.boolean().optional(),
  })
  .strict()

const ServerToolBlockSchema = z
  .object({
    type: z.enum(['server_tool_use', 'web_search_tool_result', 'web_fetch_tool_result']),
  })
  .passthrough()

const ReplyBlockSchema = z.union([ThinkingPartSchema, TextPartSchema, ServerToolBlockSchema])

const MessageUsageSchema = z
  .object({
    input_tokens: z.number().nonnegative(),
    cache_creation_input_tokens: z.number().nonnegative(),
    cache_read_input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
    server_tool_use: z
      .object({
        web_search_requests: z.number().nonnegative(),
        tool_search: z.number().nonnegative(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const AssistantErrorSchema = z
  .object({
    kind: z.enum(['http', 'stream', 'network', 'interrupted', 'protocol', 'upload']),
    message: z.string(),
    status: z.number().int().optional(),
    code: z.string().optional(),
    localMessage: JsonObjectSchema.optional(),
    retryable: z.boolean().optional(),
  })
  .passthrough()

const AssistantMessageSchema = z
  .object({
    id: z.string().min(1).max(200),
    role: z.literal('assistant'),
    createdAt: z.number().int().nonnegative(),
    model: z.enum(['deepseek-flash', 'deepseek-v4-pro']).nullable(),
    thinking: z.boolean().optional(),
    search: z.boolean().optional(),
    latestReminder: z.string().optional(),
    prefix: z.boolean(),
    status: z.enum(['pending', 'streaming', 'done', 'stopped', 'error']),
    blocks: z.array(ReplyBlockSchema).max(10_000),
    stopReason: z.enum(['end_turn', 'max_tokens', 'tool_use', 'refusal']).optional(),
    stopDetails: z
      .object({
        type: z.literal('refusal'),
        category: z.null(),
        explanation: z.null(),
      })
      .passthrough()
      .optional(),
    usage: MessageUsageSchema.optional(),
    error: AssistantErrorSchema.optional(),
    ...MessageBranchSchema,
  })
  .strict()

export const SyncSessionPayloadSchema = z
  .object({
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    title: z.string().max(1000),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    messages: z.array(z.union([UserMessageSchema, AssistantMessageSchema])).max(10_000),
    rootMessageId: z.string().nullable().optional(),
  })
  .strict()

export type SyncSessionPayload = z.infer<typeof SyncSessionPayloadSchema>

export const SyncSessionSummarySchema = z
  .object({
    id: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    title: z.string().max(1000),
    clientUpdatedAt: z.number().int().nonnegative(),
    deletedAt: z.number().int().nonnegative().nullable(),
    serverUpdatedAt: z.string(),
  })
  .strict()

export type SyncSessionSummary = z.infer<typeof SyncSessionSummarySchema>

export const SyncSessionRecordSchema = SyncSessionSummarySchema.extend({
  payload: SyncSessionPayloadSchema.nullable(),
})

export type SyncSessionRecord = z.infer<typeof SyncSessionRecordSchema>

export const SyncUpsertRequestSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    payload: SyncSessionPayloadSchema,
  })
  .strict()

export type SyncUpsertRequest = z.infer<typeof SyncUpsertRequestSchema>

export const SyncDeleteRequestSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    deletedAt: z.number().int().nonnegative(),
  })
  .strict()

export type SyncDeleteRequest = z.infer<typeof SyncDeleteRequestSchema>

export const SyncSessionsResponseSchema = z
  .object({
    sessions: z.array(SyncSessionSummarySchema),
  })
  .strict()

export type SyncSessionsResponse = z.infer<typeof SyncSessionsResponseSchema>

export const SyncSessionResponseSchema = z
  .object({
    session: SyncSessionRecordSchema,
  })
  .strict()

export type SyncSessionResponse = z.infer<typeof SyncSessionResponseSchema>
