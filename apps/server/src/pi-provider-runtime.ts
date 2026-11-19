import {
  createModels,
  createProvider,
  getSupportedThinkingLevels,
  type AssistantMessage as PiAssistantMessage,
  type Context as PiContext,
  type JsonObject,
  type Message as PiMessage,
  type Model,
  type Provider,
  type ProviderStreams,
  type Tool as PiTool,
} from '@earendil-works/pi-ai'
import * as anthropicMessages from '@earendil-works/pi-ai/api/anthropic-messages'
import * as openAICompletions from '@earendil-works/pi-ai/api/openai-completions'
import * as openAIResponses from '@earendil-works/pi-ai/api/openai-responses'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import type { ChatProxyRequest } from '@sweet-deepseek/contracts/api'
import {
  ProviderApiSchema,
  type ProviderApi,
  type ProviderModel,
  type ProviderModelInput,
  type ProviderSummary,
  type ProviderTemplate,
} from '@sweet-deepseek/contracts/providers'
import type { ProviderRecord } from './provider-store.js'

type PiBuiltinFactory = () => Provider

const BUILTIN_PROVIDER_LIST = builtinProviders()
const BUILTIN_PROVIDERS: Record<string, PiBuiltinFactory> = Object.fromEntries(
  BUILTIN_PROVIDER_LIST.map((provider) => [provider.id, () => provider])
)

const BUILTIN_TEMPLATES: ProviderTemplate[] = [
  ...BUILTIN_PROVIDER_LIST.filter(
    (provider) => provider.id !== 'deepseek' && provider.getModels().length > 0
  ).map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: 'builtin' as const,
    authModes: [
      ...(provider.auth.apiKey ? (['api_key'] as const) : []),
      ...(provider.auth.oauth ? (['oauth'] as const) : []),
    ],
  })),
  {
    id: 'custom-openai-completions',
    name: 'OpenAI-compatible',
    kind: 'custom',
    authModes: ['api_key'],
    api: 'openai-completions',
  },
  {
    id: 'custom-anthropic-messages',
    name: 'Anthropic-compatible',
    kind: 'custom',
    authModes: ['api_key'],
    api: 'anthropic-messages',
  },
  {
    id: 'custom-openai-responses',
    name: 'OpenAI Responses-compatible',
    kind: 'custom',
    authModes: ['api_key'],
    api: 'openai-responses',
  },
]

const CUSTOM_API_IMPLEMENTATIONS: Partial<Record<ProviderApi, ProviderStreams>> = {
  'openai-completions': openAICompletions,
  'anthropic-messages': anthropicMessages,
  'openai-responses': openAIResponses,
}

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { ...ZERO_COST, total: 0 },
} as const

const CLIENT_IDENTITY = {
  attribution: {
    name: "Sweet DeepSeek O'Mine",
    url: 'https://sdom.harcic.me/',
    categories: ['chat-client'],
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readApi = (value: string | null): ProviderApi | null => {
  const parsed = ProviderApiSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const modelToSummary = (model: Model<string>): ProviderModel => ({
  id: model.id,
  name: model.name,
  api: model.api as ProviderApi,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  input: [...model.input],
  reasoning: model.reasoning,
  thinkingLevels: model.reasoning ? [...getSupportedThinkingLevels(model)] : [],
})

const inputToModel = (
  providerId: string,
  baseUrl: string,
  api: ProviderApi,
  input: ProviderModelInput
): Model<string> => ({
  id: input.id,
  name: input.name ?? input.id,
  provider: providerId,
  api,
  baseUrl,
  reasoning: input.reasoning,
  input: input.input,
  contextWindow: input.contextWindow,
  maxTokens: input.maxTokens,
  cost: { ...ZERO_COST },
})

const createCustomProvider = (
  record: ProviderRecord,
  apiKey: string
): { provider: Provider; modelApi: ProviderApi } => {
  const api = readApi(record.api)
  if (!api || !record.baseUrl) {
    throw new Error('Custom provider is missing its API or base URL')
  }
  const baseUrl = record.baseUrl
  const implementation = CUSTOM_API_IMPLEMENTATIONS[api]
  if (!implementation) {
    throw new Error(`Custom provider API ${api} is not supported`)
  }
  const models = record.models.map((model) =>
    inputToModel(record.id, baseUrl, api, model)
  )
  const provider = createProvider({
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    auth: {
      apiKey: {
        name: `${record.name} API key`,
        resolve: async () => ({ auth: { apiKey } }),
      },
    },
    models,
    api: {
      [api]: {
        stream: implementation.stream,
        streamSimple: implementation.streamSimple,
      },
    } as never,
  })
  return { provider, modelApi: api }
}

const createBuiltinProvider = (
  record: ProviderRecord,
  apiKey: string
): { provider: Provider } => {
  const factory = BUILTIN_PROVIDERS[record.id]
  if (!factory) {
    throw new Error(`Unknown built-in provider: ${record.id}`)
  }
  const original = factory()
  const models = original.getModels().map((model) =>
    record.baseUrl ? { ...model, baseUrl: record.baseUrl } : model
  )
  if (models.length === 0) {
    throw new Error(`Provider ${record.id} has no chat models`)
  }
  const stream = original.stream.bind(original) as ProviderStreams['stream']
  const streamSimple = original.streamSimple.bind(original)
  const provider = createProvider({
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl ?? original.baseUrl,
    headers: original.headers,
    auth: {
      apiKey: {
        name: `${record.name} API key`,
        resolve: async () => ({ auth: { apiKey } }),
      },
    },
    models,
    api: Object.fromEntries(
      [...new Set(models.map((model) => model.api))].map((api) => [
        api,
        { stream, streamSimple },
      ])
    ) as never,
  })
  return { provider }
}

const textContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

const TITLE_MAX_LENGTH = 48

/** Pi 没有 DeepSeek 的原生标题能力；首轮直接用首条用户消息生成标题。 */
const titleFromFirstUserMessage = (request: ChatProxyRequest): string | undefined => {
  if (!request.title?.enabled) {
    return undefined
  }
  const firstUser = request.messages.find((message) => message.role === 'user')
  if (!firstUser) {
    return undefined
  }
  const text = textContent(firstUser.content).replace(/\s+/gu, ' ').trim()
  if (!text) {
    return undefined
  }
  const characters = Array.from(text)
  return characters.length > TITLE_MAX_LENGTH
    ? `${characters.slice(0, TITLE_MAX_LENGTH - 1).join('')}…`
    : text
}

const toPiMessages = (request: ChatProxyRequest): PiMessage[] => {
  const messages: PiMessage[] = []
  const toolNames = new Map<string, string>()
  let reminder: string | undefined

  for (const message of request.messages) {
    if (message.role === 'latest_reminder') {
      reminder = textContent(message.content)
      continue
    }
    if (message.role === 'user') {
      const content = message.content
      if (typeof content === 'string') {
        messages.push({ role: 'user', content, timestamp: Date.now() })
        continue
      }
      const userBlocks: Array<{ type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }> = []
      const toolResults: Array<{ type: 'tool-result'; toolCallId: string; content: string; isError: boolean }> = []
      for (const block of content) {
        if (!isRecord(block)) {
          continue
        }
        if (block.type === 'text' && typeof block.text === 'string') {
          userBlocks.push({ type: 'text', text: block.text })
        } else if (block.type === 'image' && isRecord(block.source)) {
          const source = block.source
          if (source.type === 'base64' && typeof source.data === 'string' && typeof source.media_type === 'string') {
            userBlocks.push({ type: 'image', data: source.data, mimeType: source.media_type })
          }
        } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          toolResults.push({
            type: 'tool-result',
            toolCallId: block.tool_use_id,
            content: textContent(block.content) || '(no output)',
            isError: block.is_error === true,
          })
        }
      }
      if (userBlocks.length > 0) {
        messages.push({
          role: 'user',
          content: userBlocks.map((block) =>
            block.type === 'text'
              ? { type: 'text' as const, text: block.text ?? '' }
              : { type: 'image' as const, data: block.data ?? '', mimeType: block.mimeType ?? 'image/png' }
          ),
          timestamp: Date.now(),
        })
      }
      for (const result of toolResults) {
        messages.push({
          role: 'toolResult',
          toolCallId: result.toolCallId,
          toolName: toolNames.get(result.toolCallId) ?? 'unknown',
          content: [{ type: 'text', text: result.content }],
          isError: result.isError,
          timestamp: Date.now(),
        })
      }
      continue
    }

    const assistantContent: PiAssistantMessage['content'] = []
    for (const block of message.content) {
      if (!isRecord(block)) {
        continue
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        assistantContent.push({ type: 'text', text: block.text })
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        assistantContent.push({ type: 'thinking', thinking: block.thinking })
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        toolNames.set(block.id, block.name)
        assistantContent.push({
          type: 'toolCall',
          id: block.id,
          name: block.name,
          arguments: (isRecord(block.input) ? block.input : {}) as JsonObject,
        })
      }
    }
    if (assistantContent.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantContent,
        api: 'openai-completions',
        provider: 'sdom-history',
        model: 'history',
        usage: { ...ZERO_USAGE },
        stopReason: assistantContent.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop',
        timestamp: Date.now(),
      })
    }
  }

  if (reminder && messages[0]?.role === 'user') {
    messages[0] = {
      ...messages[0],
      content:
        typeof messages[0].content === 'string'
          ? `${reminder}\n\n${messages[0].content}`
          : [{ type: 'text', text: reminder }, ...messages[0].content],
    }
  }
  return messages
}

const toPiTools = (request: ChatProxyRequest): PiTool[] =>
  request.tools.flatMap((tool) => {
    if ('type' in tool && (tool.type === 'deepseek_web_search' || tool.type === 'deepseek_read_url')) {
      return []
    }
    if (!('input_schema' in tool)) {
      return []
    }
    return [
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema as PiTool['parameters'],
      },
    ]
  })

export const providerTemplates = (): ProviderTemplate[] => BUILTIN_TEMPLATES

export const providerSummary = (
  record: ProviderRecord,
  configured: boolean
): ProviderSummary => {
  const factory = record.kind === 'builtin' ? BUILTIN_PROVIDERS[record.id] : undefined
  const authModes =
    factory !== undefined
      ? [
          ...(factory().auth.apiKey ? (['api_key'] as const) : []),
          ...(factory().auth.oauth ? (['oauth'] as const) : []),
        ]
      : (['api_key'] as const)
  const models =
    record.kind === 'builtin'
      ? (factory?.().getModels() ?? []).map((model) => modelToSummary(model))
      : record.models.map((model) => ({
          ...model,
          name: model.name ?? model.id,
          api: readApi(record.api) ?? 'openai-completions',
          thinkingLevels: model.thinkingLevels,
        }))
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    authModes: authModes.length > 0 ? [...authModes] : ['api_key'],
    configured,
    ...(record.api ? { api: record.api } : {}),
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    models,
  }
}

export const createPiSseResponse = async (
  request: ChatProxyRequest,
  record: ProviderRecord,
  apiKey: string,
  signal: AbortSignal
): Promise<Response> => {
  const custom = record.kind === 'custom'
  const { provider } = custom
    ? createCustomProvider(record, apiKey)
    : createBuiltinProvider(record, apiKey)
  const model = provider.getModels().find((candidate) => candidate.id === request.model)
  if (!model) {
    throw new Error(`Provider ${record.name} has no model ${request.model}`)
  }
  const models = createModels({ identity: CLIENT_IDENTITY })
  models.setProvider(provider)
  const context: PiContext = {
    systemPrompt: request.system,
    messages: toPiMessages(request),
    tools: toPiTools(request),
  }
  const reasoning =
    request.thinking.type === 'disabled'
      ? undefined
      : request.output_config?.effort === 'max'
        ? 'max'
        : request.output_config?.effort === 'low'
          ? 'low'
          : 'high'
  const events = models.streamSimple(model, context, {
    apiKey,
    sessionId: request.sessionId,
    ...(reasoning === undefined ? {} : { reasoning }),
    signal,
  })
  const title = titleFromFirstUserMessage(request)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }
      let closed = false
      try {
        for await (const event of events) {
          if (event.type === 'start') {
            send('message_start', {
              type: 'message_start',
              message: { id: event.partial.responseId ?? crypto.randomUUID(), model: request.model },
            })
          } else if (event.type === 'text_start') {
            send('content_block_start', {
              type: 'content_block_start',
              index: event.contentIndex,
              content_block: { type: 'text', text: '' },
            })
          } else if (event.type === 'text_delta') {
            send('content_block_delta', {
              type: 'content_block_delta',
              index: event.contentIndex,
              delta: { type: 'text_delta', text: event.delta },
            })
          } else if (event.type === 'text_end') {
            send('content_block_stop', { type: 'content_block_stop', index: event.contentIndex })
          } else if (event.type === 'thinking_start') {
            send('content_block_start', {
              type: 'content_block_start',
              index: event.contentIndex,
              content_block: { type: 'thinking', thinking: '' },
            })
          } else if (event.type === 'thinking_delta') {
            send('content_block_delta', {
              type: 'content_block_delta',
              index: event.contentIndex,
              delta: { type: 'thinking_delta', thinking: event.delta },
            })
          } else if (event.type === 'thinking_end') {
            send('content_block_stop', { type: 'content_block_stop', index: event.contentIndex })
          } else if (event.type === 'toolcall_start') {
            const partial = event.partial.content[event.contentIndex]
            send('content_block_start', {
              type: 'content_block_start',
              index: event.contentIndex,
              content_block:
                partial?.type === 'toolCall'
                  ? { type: 'tool_use', id: partial.id, name: partial.name, input: {} }
                  : { type: 'tool_use', id: '', name: '', input: {} },
            })
          } else if (event.type === 'toolcall_delta') {
            send('content_block_delta', {
              type: 'content_block_delta',
              index: event.contentIndex,
              delta: { type: 'input_json_delta', partial_json: event.delta },
            })
          } else if (event.type === 'toolcall_end') {
            send('content_block_stop', { type: 'content_block_stop', index: event.contentIndex })
          } else if (event.type === 'done' || event.type === 'error') {
            const message = event.type === 'done' ? event.message : event.error
            const usage = message.usage
            send('message_delta', {
              type: 'message_delta',
              delta: {
                stop_reason:
                  message.stopReason === 'toolUse'
                    ? 'tool_use'
                    : message.stopReason === 'length'
                      ? 'max_tokens'
                      : 'end_turn',
                stop_sequence: null,
                ...(event.type === 'done' && title ? { title } : {}),
              },
              usage: {
                input_tokens: usage.input,
                output_tokens: usage.output,
                cache_creation_input_tokens: usage.cacheWrite,
                cache_read_input_tokens: usage.cacheRead,
              },
            })
            if (event.type === 'error') {
              send('error', {
                error: {
                  message: message.errorMessage ?? 'Provider stream failed',
                  type: 'provider_error',
                },
              })
            } else {
              send('message_stop', { type: 'message_stop' })
            }
            closed = true
            controller.close()
            return
          }
        }
        if (!closed) {
          send('error', { error: { message: 'Provider stream ended unexpectedly' } })
          controller.close()
        }
      } catch (error) {
        send('error', {
          error: { message: error instanceof Error ? error.message : String(error) },
        })
        controller.close()
      }
    },
    cancel() {
      // The request signal is forwarded to Pi; no additional teardown is required.
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
