import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { SecurityService } from './security.js'

const MCP_OAUTH_AAD_PREFIX = 'mcp-oauth:v1:'
const MCP_OAUTH_CLIENT_SECRET_AAD_PREFIX = 'mcp-oauth-client-secret:v1:'

export class McpOAuthRequiredError extends Error {
  constructor() {
    super('MCP OAuth authorization is required')
    this.name = 'McpOAuthRequiredError'
  }
}

export type McpOAuthPayload = {
  issuer?: string
  codeVerifier?: string
  clientInformation?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  discoveryState?: OAuthDiscoveryState
  resourceUrl?: string
  authorizationServerUrl?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isOAuthDiscoveryState = (value: unknown): value is OAuthDiscoveryState =>
  isRecord(value) && typeof value.authorizationServerUrl === 'string'

export const mcpOAuthAdditionalData = (userId: string, serverId: string): string =>
  `${MCP_OAUTH_AAD_PREFIX}${userId}:${serverId}`

export const mcpOAuthClientSecretAdditionalData = (userId: string, serverId: string): string =>
  `${MCP_OAUTH_CLIENT_SECRET_AAD_PREFIX}${userId}:${serverId}`

export const encryptMcpOAuthClientSecret = async (
  security: SecurityService,
  userId: string,
  serverId: string,
  clientSecret: string
) => await security.encryptValue(mcpOAuthClientSecretAdditionalData(userId, serverId), clientSecret)

export const decryptMcpOAuthClientSecret = async (
  security: SecurityService,
  userId: string,
  serverId: string,
  encrypted: Parameters<SecurityService['decryptValue']>[1]
): Promise<string> =>
  await security.decryptValue(mcpOAuthClientSecretAdditionalData(userId, serverId), encrypted)

export const encryptMcpOAuthPayload = async (
  security: SecurityService,
  userId: string,
  serverId: string,
  payload: McpOAuthPayload
) => await security.encryptValue(mcpOAuthAdditionalData(userId, serverId), JSON.stringify(payload))

export const decryptMcpOAuthPayload = async (
  security: SecurityService,
  userId: string,
  serverId: string,
  encrypted: Parameters<SecurityService['decryptValue']>[1]
): Promise<McpOAuthPayload> => {
  const raw = await security.decryptValue(mcpOAuthAdditionalData(userId, serverId), encrypted)
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) {
    throw new Error('Stored MCP OAuth payload is invalid')
  }
  if (
    (parsed.issuer !== undefined && typeof parsed.issuer !== 'string') ||
    (parsed.codeVerifier !== undefined && typeof parsed.codeVerifier !== 'string') ||
    (parsed.clientInformation !== undefined && !isRecord(parsed.clientInformation)) ||
    (parsed.tokens !== undefined && !isRecord(parsed.tokens)) ||
    (parsed.discoveryState !== undefined && !isOAuthDiscoveryState(parsed.discoveryState)) ||
    (parsed.resourceUrl !== undefined && typeof parsed.resourceUrl !== 'string') ||
    (parsed.authorizationServerUrl !== undefined &&
      typeof parsed.authorizationServerUrl !== 'string')
  ) {
    throw new Error('Stored MCP OAuth payload is invalid')
  }
  return {
    ...(parsed.issuer === undefined ? {} : { issuer: parsed.issuer }),
    ...(parsed.codeVerifier === undefined ? {} : { codeVerifier: parsed.codeVerifier }),
    ...(parsed.clientInformation === undefined
      ? {}
      : { clientInformation: parsed.clientInformation as StoredOAuthClientInformation }),
    ...(parsed.tokens === undefined ? {} : { tokens: parsed.tokens as StoredOAuthTokens }),
    ...(parsed.discoveryState === undefined ? {} : { discoveryState: parsed.discoveryState }),
    ...(parsed.resourceUrl === undefined ? {} : { resourceUrl: parsed.resourceUrl }),
    ...(parsed.authorizationServerUrl === undefined
      ? {}
      : { authorizationServerUrl: parsed.authorizationServerUrl }),
  }
}

export type McpOAuthProviderOptions = {
  state: string
  redirectUrl: string
  initialPayload?: McpOAuthPayload
  clientInformation?: StoredOAuthClientInformation
  clientAuthMethod?: 'none' | 'client_secret_post'
  persist: (payload: McpOAuthPayload) => Promise<void>
}

export class McpOAuthProvider implements OAuthClientProvider {
  private payload: McpOAuthPayload
  private authorizationUrl: URL | null = null
  private readonly stateValue: string
  private readonly redirect: string
  private readonly configuredClientInformation: StoredOAuthClientInformation | undefined
  private readonly clientAuthMethod: 'none' | 'client_secret_post'
  private readonly persist: (payload: McpOAuthPayload) => Promise<void>

  constructor({
    state,
    redirectUrl,
    initialPayload = {},
    clientInformation,
    clientAuthMethod = 'none',
    persist,
  }: McpOAuthProviderOptions) {
    this.stateValue = state
    this.redirect = redirectUrl
    this.payload = structuredClone(initialPayload)
    this.configuredClientInformation = clientInformation
    this.clientAuthMethod = clientAuthMethod
    this.persist = persist
  }

  get redirectUrl(): string {
    return this.redirect
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Sweet DeepSeek O'Mine",
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.clientAuthMethod,
    }
  }

  state(): string {
    return this.stateValue
  }

  clientInformation(
    context?: OAuthClientInformationContext
  ): StoredOAuthClientInformation | undefined {
    const information = this.configuredClientInformation ?? this.payload.clientInformation
    if (!information || !context?.issuer) {
      return information
    }
    return { ...information, issuer: context.issuer }
  }

  async saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    this.payload.clientInformation = context?.issuer
      ? { ...clientInformation, issuer: context.issuer }
      : clientInformation
    await this.persist(this.payload)
  }

  tokens(): StoredOAuthTokens | undefined {
    return this.payload.tokens
  }

  async saveTokens(
    tokens: StoredOAuthTokens,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    this.payload.tokens = context?.issuer ? { ...tokens, issuer: context.issuer } : tokens
    if (context?.issuer) {
      this.payload.issuer = context.issuer
    }
    await this.persist(this.payload)
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.payload.codeVerifier = codeVerifier
    await this.persist(this.payload)
  }

  codeVerifier(): string {
    if (!this.payload.codeVerifier) {
      throw new Error('MCP OAuth code verifier is missing')
    }
    return this.payload.codeVerifier
  }

  async saveAuthorizationServerUrl(authorizationServerUrl: string): Promise<void> {
    this.payload.authorizationServerUrl = authorizationServerUrl
    await this.persist(this.payload)
  }

  authorizationServerUrl(): string | undefined {
    return this.payload.authorizationServerUrl
  }

  async saveResourceUrl(resourceUrl: string): Promise<void> {
    this.payload.resourceUrl = resourceUrl
    await this.persist(this.payload)
  }

  resourceUrl(): string | undefined {
    return this.payload.resourceUrl
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    this.payload.discoveryState = discoveryState
    await this.persist(this.payload)
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.payload.discoveryState
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'all' || scope === 'client') {
      delete this.payload.clientInformation
    }
    if (scope === 'all' || scope === 'tokens') {
      delete this.payload.tokens
    }
    if (scope === 'all' || scope === 'verifier') {
      delete this.payload.codeVerifier
    }
    if (scope === 'all' || scope === 'discovery') {
      delete this.payload.discoveryState
    }
    await this.persist(this.payload)
  }

  getAuthorizationUrl(): string | null {
    return this.authorizationUrl?.toString() ?? null
  }

  snapshot(): McpOAuthPayload {
    return structuredClone(this.payload)
  }
}
