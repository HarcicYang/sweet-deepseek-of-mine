import { z } from 'zod'
import { ThinkingEffortSchema } from './deepseek.js'

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
  mcpServers: '/api/mcp/servers',
  mcpServer: '/api/mcp/servers/:serverId',
  mcpServerProbe: '/api/mcp/servers/:serverId/probe',
  mcpServerOAuthStart: '/api/mcp/servers/:serverId/oauth/start',
  mcpServerOAuthDisconnect: '/api/mcp/servers/:serverId/oauth/disconnect',
  mcpOAuthCallback: '/api/mcp/oauth/callback',
  mcpTools: '/api/mcp/tools',
  mcpToolCall: '/api/mcp/call',
  shares: '/api/shares',
  sharedSession: '/api/shares/:token',
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
  'mcp_auth_required',
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

const ChatNativeToolSchema = z
  .object({
    type: z.enum(['deepseek_web_search', 'deepseek_read_url']),
    name: z.enum(['deepseek_web_search', 'deepseek_read_url']),
  })
  .strict()

const ChatCustomFunctionToolSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/u),
    description: z.string().max(100_000),
    input_schema: z.record(z.string(), z.unknown()),
  })
  .strict()

const ChatToolSchema = z.union([ChatNativeToolSchema, ChatCustomFunctionToolSchema])

export const ChatProxyRequestSchema = z
  .object({
    model: z.enum(['deepseek-flash', 'deepseek-v4-pro']),
    system: z.string().max(200_000),
    messages: z.array(ChatMessageSchema).min(1).max(500),
    thinking: z.object({ type: z.enum(['enabled', 'disabled']) }).strict(),
    output_config: z.object({ effort: ThinkingEffortSchema }).strict().optional(),
    tools: z
      .array(ChatToolSchema)
      .max(64)
      .superRefine((tools, context) => {
        const names = new Set<string>()
        tools.forEach((tool, index) => {
          if (names.has(tool.name)) {
            context.addIssue({
              code: 'custom',
              path: [index, 'name'],
              message: `Duplicate tool name: ${tool.name}`,
            })
          }
          names.add(tool.name)
        })
      }),
    safety_check: z.object({ level: z.literal('high') }).strict(),
    title: z.object({ enabled: z.boolean() }).strict().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.thinking.type === 'disabled' && request.output_config) {
      context.addIssue({
        code: 'custom',
        path: ['output_config'],
        message: 'Thinking effort must be omitted when thinking is disabled',
      })
    }
  })

export type ChatProxyRequest = z.infer<typeof ChatProxyRequestSchema>
