import {
  auth,
  Client,
  StreamableHTTPClientTransport,
  type AuthResult,
  type FetchLike,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client'

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_CALL_TIMEOUT_MS = 60_000
const MAX_RESULT_TEXT_LENGTH = 1_000_000

export type McpConnectionConfig = {
  url: string
  headers: Record<string, string>
  trustMode: 'prompt' | 'trust-hints'
  authProvider?: OAuthClientProvider
}

export type McpRemoteTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

export type McpProbeSuccess = {
  ok: true
  server: {
    name?: string
    version?: string
  }
  tools: McpRemoteTool[]
  durationMs: number
}

export type McpProbeFailure = {
  ok: false
  stage: 'connect' | 'list'
  message: string
  durationMs: number
}

export type McpProbeResult = McpProbeSuccess | McpProbeFailure

export type McpToolCallResult = {
  content: { type: 'text'; text: string }[]
  isError: boolean
}

export class McpToolNotFoundError extends Error {
  constructor() {
    super('MCP tool not found')
    this.name = 'McpToolNotFoundError'
  }
}

export class McpApprovalRequiredError extends Error {
  constructor() {
    super('MCP tool requires explicit approval')
    this.name = 'McpApprovalRequiredError'
  }
}

export type McpClient = {
  probe: (config: McpConnectionConfig, signal?: AbortSignal) => Promise<McpProbeResult>
  callTool: (
    config: McpConnectionConfig,
    rawName: string,
    args: Record<string, unknown>,
    approved: boolean,
    signal?: AbortSignal
  ) => Promise<McpToolCallResult>
  beginOAuth: (
    config: McpConnectionConfig,
    provider: OAuthClientProvider,
    signal?: AbortSignal
  ) => Promise<AuthResult>
  completeOAuth: (
    config: McpConnectionConfig,
    provider: OAuthClientProvider,
    callbackParams: URLSearchParams,
    signal?: AbortSignal
  ) => Promise<void>
}

export type McpClientOptions = {
  fetchImpl?: FetchLike
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

const redactHeaders = (message: string, headers: Record<string, string>): string =>
  Object.values(headers)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((current, secret) => current.replaceAll(secret, '[redacted]'), message)

const truncateText = (value: string): string =>
  value.length <= MAX_RESULT_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_RESULT_TEXT_LENGTH)}\n\n[MCP result truncated]`

const createSignal = (signal: AbortSignal | undefined, timeoutMs: number): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)

const fetchWithSignal =
  (fetchImpl: FetchLike, signal: AbortSignal): FetchLike =>
  async (input, init) =>
    await fetchImpl(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    })

const readTools = (tools: readonly unknown[]): McpRemoteTool[] =>
  tools.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.name !== 'string' ||
      value.name.length === 0 ||
      value.name.length > 256 ||
      !isRecord(value.inputSchema)
    ) {
      throw new Error('MCP server returned an invalid tool definition')
    }
    const annotations = isRecord(value.annotations) ? value.annotations : null
    return {
      name: value.name,
      description: typeof value.description === 'string' ? value.description : '',
      inputSchema: value.inputSchema,
      readOnly: annotations?.readOnlyHint === true,
    }
  })

const readContent = (content: readonly unknown[]): { type: 'text'; text: string }[] => {
  const blocks = content.flatMap((value): { type: 'text'; text: string }[] => {
    if (!isRecord(value)) {
      return []
    }
    if (value.type === 'text' && typeof value.text === 'string') {
      return [{ type: 'text', text: truncateText(value.text) }]
    }
    if (value.type === 'image') {
      return [{ type: 'text', text: '[Image content from MCP is not displayed yet.]' }]
    }
    if (value.type === 'audio') {
      return [{ type: 'text', text: '[Audio content from MCP is not supported.]' }]
    }
    if (value.type === 'resource_link' && typeof value.uri === 'string') {
      return [{ type: 'text', text: `Resource: ${value.uri}` }]
    }
    return []
  })
  return blocks.length > 0 ? blocks : [{ type: 'text', text: 'MCP tool returned no text content.' }]
}

const connect = async (
  config: McpConnectionConfig,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<{
  client: Client
  transport: StreamableHTTPClientTransport
}> => {
  const client = new Client(
    { name: 'sweet-deepseek-o-mine', version: '0.1.1' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } }
  )
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    // Workers only supports follow/manual; manual keeps redirects from becoming an SSRF path.
    requestInit: { headers: config.headers, redirect: 'manual' },
    fetch: fetchImpl,
    ...(config.authProvider === undefined ? {} : { authProvider: config.authProvider }),
  })
  try {
    await client.connect(transport, { signal })
  } catch (error) {
    await transport.close().catch(() => undefined)
    throw error
  }
  return { client, transport }
}

const closeConnection = async (client: Client, transport: StreamableHTTPClientTransport) => {
  await (client.transport === undefined ? transport.close() : client.close()).catch(() => undefined)
}

export const createMcpClient = ({ fetchImpl = fetch }: McpClientOptions = {}): McpClient => ({
  probe: async (config, signal) => {
    const startedAt = Date.now()
    const operationSignal = createSignal(signal, DEFAULT_STARTUP_TIMEOUT_MS)
    let stage: 'connect' | 'list' = 'connect'
    let connection: Awaited<ReturnType<typeof connect>> | null = null
    try {
      connection = await connect(config, operationSignal, fetchImpl)
      const identity = connection.client.getServerVersion()
      stage = 'list'
      const response =
        connection.client.getServerCapabilities()?.tools === undefined
          ? { tools: [] }
          : await connection.client.listTools(undefined, {
              cacheMode: 'refresh',
              signal: operationSignal,
            })
      return {
        ok: true,
        server: {
          ...(identity?.name ? { name: identity.name } : {}),
          ...(identity?.version ? { version: identity.version } : {}),
        },
        tools: readTools(response.tools),
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      return {
        ok: false,
        stage,
        message: signal?.aborted
          ? 'MCP probe aborted'
          : redactHeaders(errorMessage(error), config.headers),
        durationMs: Date.now() - startedAt,
      }
    } finally {
      if (connection) {
        await closeConnection(connection.client, connection.transport)
      }
    }
  },
  callTool: async (config, rawName, args, approved, signal) => {
    const operationSignal = createSignal(signal, DEFAULT_CALL_TIMEOUT_MS)
    let connection: Awaited<ReturnType<typeof connect>> | null = null
    try {
      connection = await connect(config, operationSignal, fetchImpl)
      const response =
        connection.client.getServerCapabilities()?.tools === undefined
          ? { tools: [] }
          : await connection.client.listTools(undefined, {
              cacheMode: 'refresh',
              signal: operationSignal,
            })
      const tool = readTools(response.tools).find((candidate) => candidate.name === rawName)
      if (!tool) {
        throw new McpToolNotFoundError()
      }
      if (!(config.trustMode === 'trust-hints' && tool.readOnly) && !approved) {
        throw new McpApprovalRequiredError()
      }
      const result = await connection.client.callTool(
        { name: rawName, arguments: args },
        { signal: operationSignal, timeout: DEFAULT_CALL_TIMEOUT_MS }
      )
      return {
        content: readContent(result.content),
        isError: result.isError === true,
      }
    } finally {
      if (connection) {
        await closeConnection(connection.client, connection.transport)
      }
    }
  },
  beginOAuth: async (config, provider, signal) => {
    const operationSignal = createSignal(signal, DEFAULT_STARTUP_TIMEOUT_MS)
    return await auth(provider, {
      serverUrl: config.url,
      fetchFn: fetchWithSignal(fetchImpl, operationSignal),
      forceReauthorization: true,
    })
  },
  completeOAuth: async (config, provider, callbackParams, signal) => {
    const operationSignal = createSignal(signal, DEFAULT_STARTUP_TIMEOUT_MS)
    const code = callbackParams.get('code')
    if (!code) {
      throw new Error('MCP OAuth callback is missing a code')
    }
    await auth(provider, {
      serverUrl: config.url,
      authorizationCode: code,
      ...(callbackParams.get('iss') === null
        ? {}
        : { iss: callbackParams.get('iss') ?? undefined }),
      fetchFn: fetchWithSignal(fetchImpl, operationSignal),
    })
  },
})
