export type McpOAuthClientAuthMethod = 'none' | 'client_secret_post'

export type McpOAuthClientInput = {
  resource: string
  clientId: string
  clientSecret?: string
  redirectUrl?: string
  clientAuthMethod?: McpOAuthClientAuthMethod
}

export type McpOAuthClientConfig = {
  resource: string
  clientId: string
  clientSecret?: string
  redirectUrl: string
  clientAuthMethod: McpOAuthClientAuthMethod
}

const ALLOWED_FIELDS = new Set([
  'resource',
  'clientId',
  'clientSecret',
  'redirectUrl',
  'clientAuthMethod',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readUrl = (value: unknown, field: string): URL => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty URL`)
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`${field} must be a valid URL`)
  }
  if (url.protocol !== 'https:' && !isLoopback(url)) {
    throw new Error(`${field} must use HTTPS outside loopback development`)
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${field} cannot contain credentials or fragments`)
  }
  return url
}

const isLoopback = (url: URL): boolean =>
  url.hostname === 'localhost' ||
  url.hostname.endsWith('.localhost') ||
  url.hostname === '127.0.0.1' ||
  url.hostname === '[::1]'

const normalizeEndpoint = (value: string): string => {
  const url = new URL(value)
  url.hash = ''
  return url.toString()
}

const isOriginMatch = (url: URL): boolean => url.pathname === '/' && url.search === ''

const parseClient = (value: unknown, fallbackRedirectUrl: string): McpOAuthClientConfig => {
  if (!isRecord(value)) {
    throw new Error('Each MCP OAuth client must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new Error(`Unknown MCP OAuth client field: ${key}`)
    }
  }

  const resource = readUrl(value.resource, 'resource').toString()
  const redirectUrl =
    value.redirectUrl === undefined
      ? readUrl(fallbackRedirectUrl, 'redirectUrl').toString()
      : readUrl(value.redirectUrl, 'redirectUrl').toString()
  const clientId =
    typeof value.clientId === 'string' && value.clientId.trim() !== ''
      ? value.clientId.trim()
      : null
  if (!clientId || clientId.length > 512) {
    throw new Error('clientId must be a non-empty string of at most 512 characters')
  }

  const clientSecret =
    value.clientSecret === undefined
      ? undefined
      : typeof value.clientSecret === 'string' && value.clientSecret.trim() !== ''
        ? value.clientSecret.trim()
        : null
  if (clientSecret === null || (clientSecret?.length ?? 0) > 16_384) {
    throw new Error('clientSecret must be a non-empty string of at most 16384 characters')
  }

  const requestedAuthMethod = value.clientAuthMethod
  if (
    requestedAuthMethod !== undefined &&
    requestedAuthMethod !== 'none' &&
    requestedAuthMethod !== 'client_secret_post'
  ) {
    throw new Error('clientAuthMethod must be none or client_secret_post')
  }
  const clientAuthMethod =
    requestedAuthMethod ?? (clientSecret === undefined ? 'none' : 'client_secret_post')
  if (clientAuthMethod === 'client_secret_post' && clientSecret === undefined) {
    throw new Error('client_secret_post requires clientSecret')
  }
  if (clientAuthMethod === 'none' && clientSecret !== undefined) {
    throw new Error('clientSecret cannot be used with the none clientAuthMethod')
  }

  return {
    resource,
    clientId,
    ...(clientSecret === undefined ? {} : { clientSecret }),
    redirectUrl,
    clientAuthMethod,
  }
}

export const parseMcpOAuthClients = (
  raw: string | undefined,
  {
    fallbackRedirectUrl,
    defaults = [],
  }: {
    fallbackRedirectUrl: string
    defaults?: McpOAuthClientInput[]
  }
): McpOAuthClientConfig[] => {
  let configured: unknown[] = []
  if (raw?.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error('MCP_OAUTH_CLIENTS must be a JSON array')
      }
      configured = parsed
    } catch (error) {
      throw error instanceof Error
        ? new Error(`Invalid MCP_OAUTH_CLIENTS: ${error.message}`)
        : new Error('Invalid MCP_OAUTH_CLIENTS')
    }
  }
  return [...defaults, ...configured].map((client) => parseClient(client, fallbackRedirectUrl))
}

export const findMcpOAuthClient = (
  clients: McpOAuthClientConfig[],
  serverUrl: string
): McpOAuthClientConfig | undefined => {
  let target: URL
  try {
    target = new URL(serverUrl)
  } catch {
    return undefined
  }
  const normalizedTarget = normalizeEndpoint(target.toString())
  let selected: McpOAuthClientConfig | undefined
  let selectedScore = 0
  for (const client of clients) {
    const resource = new URL(client.resource)
    const matches = isOriginMatch(resource)
      ? target.origin === resource.origin
      : normalizedTarget === normalizeEndpoint(client.resource)
    const score = matches ? (isOriginMatch(resource) ? 1 : 2) : 0
    // Later entries win ties, allowing an explicit deployment override.
    if (score >= selectedScore && score > 0) {
      selected = client
      selectedScore = score
    }
  }
  return selected
}
