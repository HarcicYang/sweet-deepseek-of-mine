import { z } from 'zod'

export const apiRoutes = {
  health: '/api/health',
  githubStart: '/api/auth/github/start',
  githubCallback: '/api/auth/github/callback',
  session: '/api/auth/session',
  logout: '/api/auth/logout',
  deepseekKey: '/api/account/deepseek-key',
  chat: '/api/chat',
  files: '/api/files',
  file: '/api/files/:fileId',
  speechAsr: '/api/speech/asr',
  speechTts: '/api/speech/tts',
  jsonRenderValidate: '/api/json-render/validate',
  syncSessions: '/api/sync/sessions',
  syncSession: '/api/sync/sessions/:sessionId',
  syncSettings: '/api/sync/settings',
} as const

export const ApiErrorCodeSchema = z.enum([
  'invalid_request',
  'unauthorized',
  'forbidden',
  'conflict',
  'api_key_missing',
  'invalid_api_key',
  'credential_error',
  'upstream_error',
  'sync_conflict',
  'server_error',
])

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string(),
      })
      .strict(),
  })
  .strict()

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>

export const AuthUserSchema = z
  .object({
    id: z.string().min(1),
    githubLogin: z.string().min(1),
    avatarUrl: z.string().url().nullable(),
    hasApiKey: z.boolean(),
  })
  .strict()

export type AuthUser = z.infer<typeof AuthUserSchema>

export const SessionResponseSchema = z.object({ user: AuthUserSchema }).strict()

export type SessionResponse = z.infer<typeof SessionResponseSchema>

export const ApiKeyRequestSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(512),
  })
  .strict()

export type ApiKeyRequest = z.infer<typeof ApiKeyRequestSchema>

export const ApiKeyStatusResponseSchema = z.object({ configured: z.boolean() }).strict()

export type ApiKeyStatusResponse = z.infer<typeof ApiKeyStatusResponseSchema>

export const FilePurposeSchema = z.enum(['rich_layout_recognition', 'user_data'])

export const FileObjectResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('file'),
  size_bytes: z.number().int().nonnegative(),
  created_at: z.string(),
  filename: z.string(),
  mime_type: z.string(),
})

export type FileObjectResponse = z.infer<typeof FileObjectResponseSchema>

export const SpeechTranscriptionResponseSchema = z.object({ text: z.string() })

export const SpeechSynthesisRequestSchema = z
  .object({
    text: z.string().min(1).max(100_000),
    voice_id: z.enum(['stella', 'tide']),
    format: z.literal('pcm'),
    filter_markdown: z.literal(true),
  })
  .strict()

const ChatMessageSchema = z
  .object({
    role: z.enum(['latest_reminder', 'user', 'assistant']),
    content: z.union([z.string().max(2_000_000), z.array(z.unknown()).max(2_000)]),
  })
  .strict()

const ChatToolSchema = z
  .object({
    type: z.enum(['deepseek_web_search', 'deepseek_read_url']),
    name: z.enum(['deepseek_web_search', 'deepseek_read_url']),
  })
  .strict()

export const ChatProxyRequestSchema = z
  .object({
    model: z.enum(['deepseek-flash', 'deepseek-v4-pro']),
    system: z.string().max(200_000),
    messages: z.array(ChatMessageSchema).min(1).max(500),
    thinking: z.object({ type: z.enum(['enabled', 'disabled']) }).strict(),
    tools: z.array(ChatToolSchema).max(8),
    safety_check: z.object({ level: z.literal('high') }).strict(),
    title: z.object({ enabled: z.boolean() }).strict().optional(),
  })
  .strict()

export type ChatProxyRequest = z.infer<typeof ChatProxyRequestSchema>
