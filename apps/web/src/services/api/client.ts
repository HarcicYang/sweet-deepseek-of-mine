import {
  readApiErrorBody,
  readMessageEvent,
  type ApiErrorBody,
  type CreateMessageRequest,
  type FileObject,
  type FilePurpose,
  type MessageStreamEvent,
} from '@sweet-deepseek/contracts'
import {
  ApiKeyStatusResponseSchema,
  FileObjectResponseSchema,
  SessionResponseSchema,
  apiRoutes,
  type ApiKeyStatusResponse,
  type SessionResponse,
} from '@sweet-deepseek/contracts/api'
import {
  SyncSettingsResponseSchema,
  SyncSessionResponseSchema,
  SyncSessionsResponseSchema,
  type SyncedSettingsPayload,
  type SyncSessionPayload,
  type SyncSessionRecord,
  type SyncSessionSummary,
  type SyncSettingsRecord,
} from '@sweet-deepseek/contracts/sync'
import {
  ShareCreateResponseSchema,
  SharedSessionResponseSchema,
  type ShareCreateResponse,
  type SharedSessionResponse,
} from '@sweet-deepseek/contracts/share'
import {
  McpProbeResponseSchema,
  McpOAuthStartResponseSchema,
  McpServerResponseSchema,
  McpServersResponseSchema,
  McpToolCallResponseSchema,
  McpToolsResponseSchema,
  type McpProbeResponse,
  type McpOAuthStartResponse,
  type McpServerInput,
  type McpServerSummary,
  type McpServerUpdate,
  type McpToolCallResponse,
  type McpToolSummary,
} from '@sweet-deepseek/contracts/mcp'
import {
  JsonRenderValidationResponseSchema,
  type JsonRenderDocument,
} from '@sweet-deepseek/json-render'
import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readServerSentEvents } from './sse.js'

const apiBaseUrl = __SDOM_API_BASE_URL__.replace(/\/+$/u, '')
const apiUrl = (path: string) => (path.startsWith('/') ? `${apiBaseUrl}${path}` : path)

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number,
    readonly code?: string
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

type ParsedError = {
  message: string
  code?: string
}

const readErrorBody = (text: string): ParsedError | null => {
  try {
    const body: unknown = JSON.parse(text)
    const errorBody: ApiErrorBody | null = readApiErrorBody(body)
    if (!errorBody) {
      return null
    }
    return {
      message: errorBody.error.message,
      ...(typeof errorBody.error.code === 'string' ? { code: errorBody.error.code } : {}),
    }
  } catch {
    return null
  }
}

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  const parsed = readErrorBody(text)
  return new ApiError(kind, parsed?.message || text || fallback, response.status, parsed?.code)
}

const notifyUnauthorized = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sdom:auth-expired'))
  }
}

export const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(apiUrl(url), { credentials: 'include', ...init })
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    if (response.status === 401) {
      notifyUnauthorized()
    }
    throw await readErrorResponse(response)
  }
  return response
}

const parseResponse = <Value>(
  schema: { safeParse: (value: unknown) => { success: true; data: Value } | { success: false } },
  value: unknown
): Value => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError('protocol', 'Invalid server response')
  }
  return parsed.data
}

export const beginGithubLogin = () => {
  window.location.assign(apiUrl(apiRoutes.githubStart))
}

const JSON_RENDER_CACHE_LIMIT = 32
const jsonRenderCache = new Map<string, JsonRenderDocument>()
const jsonRenderRequests = new Map<string, Promise<JsonRenderDocument>>()

/** Validate untrusted model-generated UI with the server before rendering it. */
export const validateJsonRenderSource = (source: string): Promise<JsonRenderDocument> => {
  const cached = jsonRenderCache.get(source)
  if (cached) {
    return Promise.resolve(cached)
  }
  const pending = jsonRenderRequests.get(source)
  if (pending) {
    return pending
  }
  const requestPromise = request(apiRoutes.jsonRenderValidate, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
    .then(
      async (response) =>
        parseResponse(JsonRenderValidationResponseSchema, await response.json()).document
    )
    .then((document) => {
      if (jsonRenderCache.size >= JSON_RENDER_CACHE_LIMIT) {
        const oldest = jsonRenderCache.keys().next().value
        if (oldest !== undefined) {
          jsonRenderCache.delete(oldest)
        }
      }
      jsonRenderCache.set(source, document)
      return document
    })
    .finally(() => {
      jsonRenderRequests.delete(source)
    })
  jsonRenderRequests.set(source, requestPromise)
  return requestPromise
}

export const getSession = async (signal?: AbortSignal): Promise<SessionResponse> => {
  const response = await request(apiRoutes.session, { signal })
  return parseResponse(SessionResponseSchema, await response.json())
}

export const createShare = async (
  session: SyncSessionPayload,
  expiresInDays: number
): Promise<ShareCreateResponse> => {
  const response = await request(apiRoutes.shares, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, expiresInDays }),
  })
  return parseResponse(ShareCreateResponseSchema, await response.json())
}

export const getSharedSession = async (
  token: string,
  signal?: AbortSignal
): Promise<SharedSessionResponse> => {
  const response = await request(
    apiRoutes.sharedSession.replace(':token', encodeURIComponent(token)),
    { credentials: 'omit', signal }
  )
  return parseResponse(SharedSessionResponseSchema, await response.json())
}

export const listMcpServers = async (): Promise<McpServerSummary[]> => {
  const response = await request(apiRoutes.mcpServers)
  return parseResponse(McpServersResponseSchema, await response.json()).servers
}

export const createMcpServer = async (input: McpServerInput): Promise<McpServerSummary> => {
  const response = await request(apiRoutes.mcpServers, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseResponse(McpServerResponseSchema, await response.json()).server
}

export const updateMcpServer = async (
  serverId: string,
  update: McpServerUpdate
): Promise<McpServerSummary> => {
  const response = await request(
    apiRoutes.mcpServer.replace(':serverId', encodeURIComponent(serverId)),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }
  )
  return parseResponse(McpServerResponseSchema, await response.json()).server
}

export const deleteMcpServer = async (serverId: string): Promise<void> => {
  await request(apiRoutes.mcpServer.replace(':serverId', encodeURIComponent(serverId)), {
    method: 'DELETE',
  })
}

export const probeMcpServer = async (serverId: string): Promise<McpProbeResponse> => {
  const response = await request(
    apiRoutes.mcpServerProbe.replace(':serverId', encodeURIComponent(serverId)),
    { method: 'POST' }
  )
  return parseResponse(McpProbeResponseSchema, await response.json())
}

export const startMcpOAuth = async (serverId: string): Promise<McpOAuthStartResponse> => {
  const response = await request(
    apiRoutes.mcpServerOAuthStart.replace(':serverId', encodeURIComponent(serverId)),
    { method: 'POST' }
  )
  return parseResponse(McpOAuthStartResponseSchema, await response.json())
}

export const disconnectMcpOAuth = async (serverId: string): Promise<void> => {
  await request(
    apiRoutes.mcpServerOAuthDisconnect.replace(':serverId', encodeURIComponent(serverId)),
    { method: 'POST' }
  )
}

export const listMcpTools = async (signal?: AbortSignal): Promise<McpToolSummary[]> => {
  const response = await request(apiRoutes.mcpTools, { signal })
  return parseResponse(McpToolsResponseSchema, await response.json()).tools
}

export const callMcpTool = async (
  serverId: string,
  rawName: string,
  args: Record<string, unknown>,
  approved: boolean,
  signal?: AbortSignal
): Promise<McpToolCallResponse> => {
  const response = await request(apiRoutes.mcpToolCall, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, rawName, arguments: args, approved }),
    signal,
  })
  return parseResponse(McpToolCallResponseSchema, await response.json())
}

export const logout = async (): Promise<void> => {
  await request(apiRoutes.logout, { method: 'POST' })
}

export const saveDeepSeekKey = async (apiKey: string): Promise<ApiKeyStatusResponse> => {
  const response = await request(apiRoutes.deepseekKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  return parseResponse(ApiKeyStatusResponseSchema, await response.json())
}

export const deleteDeepSeekKey = async (): Promise<ApiKeyStatusResponse> => {
  const response = await request(apiRoutes.deepseekKey, { method: 'DELETE' })
  return parseResponse(ApiKeyStatusResponseSchema, await response.json())
}

export const listCloudSessions = async (): Promise<SyncSessionSummary[]> => {
  const response = await request(apiRoutes.syncSessions)
  return parseResponse(SyncSessionsResponseSchema, await response.json()).sessions
}

export const getCloudSession = async (sessionId: string): Promise<SyncSessionRecord> => {
  const response = await request(
    apiRoutes.syncSession.replace(':sessionId', encodeURIComponent(sessionId))
  )
  return parseResponse(SyncSessionResponseSchema, await response.json()).session
}

export const putCloudSession = async (
  sessionId: string,
  baseRevision: number,
  payload: SyncSessionPayload
): Promise<SyncSessionRecord> => {
  const response = await request(
    apiRoutes.syncSession.replace(':sessionId', encodeURIComponent(sessionId)),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision, payload }),
    }
  )
  return parseResponse(SyncSessionResponseSchema, await response.json()).session
}

export const deleteCloudSession = async (
  sessionId: string,
  baseRevision: number,
  deletedAt: number
): Promise<SyncSessionRecord> => {
  const response = await request(
    apiRoutes.syncSession.replace(':sessionId', encodeURIComponent(sessionId)),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision, deletedAt }),
    }
  )
  return parseResponse(SyncSessionResponseSchema, await response.json()).session
}

export const clearCloudSessions = async (): Promise<void> => {
  await request(apiRoutes.syncSessions, { method: 'DELETE' })
}

export const getCloudSettings = async (): Promise<SyncSettingsRecord | null> => {
  const response = await request(apiRoutes.syncSettings)
  return parseResponse(SyncSettingsResponseSchema, await response.json()).settings
}

export const putCloudSettings = async (
  baseRevision: number,
  payload: SyncedSettingsPayload
): Promise<SyncSettingsRecord> => {
  const response = await request(apiRoutes.syncSettings, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, payload }),
  })
  const settings = parseResponse(SyncSettingsResponseSchema, await response.json()).settings
  if (!settings) {
    throw new ApiError('protocol', 'Server returned empty settings after update')
  }
  return settings
}

/**
 * POST /api/files 上传附件。服务端代理 DeepSeek Files API，并继续要求
 * purpose 排在 file 之前。
 */
export const uploadFile = async (
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(apiRoutes.files, {
    method: 'POST',
    body: form,
    signal,
  })
  return parseResponse(FileObjectResponseSchema, await response.json())
}

/** DELETE /api/files/{file_id} */
export const deleteFile = async (fileId: string): Promise<void> => {
  await request(apiRoutes.file.replace(':fileId', encodeURIComponent(fileId)), {
    method: 'DELETE',
  })
}

/**
 * POST /api/chat（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(apiRoutes.chat, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    const errorBody = readApiErrorBody(payload)
    if (errorBody) {
      throw new ApiError(
        'stream',
        errorBody.error.message,
        undefined,
        errorBody.error.code ?? undefined
      )
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
