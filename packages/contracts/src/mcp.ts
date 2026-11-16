import { z } from 'zod'

export const MCP_SERVER_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/u
export const MCP_PUBLIC_TOOL_NAME_MAX_LENGTH = 64

export const McpAuthModeSchema = z.enum(['static', 'oauth'])
export const McpTrustModeSchema = z.enum(['prompt', 'trust-hints'])

const HeaderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u)
  .refine(
    (name) =>
      ![
        '__proto__',
        'connection',
        'constructor',
        'content-length',
        'host',
        'prototype',
        'transfer-encoding',
        'upgrade',
      ].includes(name.toLowerCase()),
    'Unsupported request header'
  )

const HeaderValueSchema = z
  .string()
  .max(16_384)
  .refine((value) => !/[\r\n]/u.test(value), 'Header values cannot contain newlines')

export const McpHeadersSchema = z
  .record(HeaderNameSchema, HeaderValueSchema)
  .refine((headers) => Object.keys(headers).length <= 32, 'Too many request headers')

export const McpServerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().regex(MCP_SERVER_SLUG_PATTERN),
    url: z.string().trim().url().max(2048),
    headers: McpHeadersSchema.optional(),
    authMode: McpAuthModeSchema.default('static'),
    trustMode: McpTrustModeSchema.default('prompt'),
    enabled: z.boolean(),
  })
  .strict()

export const McpServerUpdateSchema = McpServerInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required'
)

export const McpServerSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().regex(MCP_SERVER_SLUG_PATTERN),
    url: z.string().url(),
    authMode: McpAuthModeSchema,
    trustMode: McpTrustModeSchema,
    oauthConnected: z.boolean(),
    enabled: z.boolean(),
    headerNames: z.array(HeaderNameSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

export const McpServersResponseSchema = z
  .object({
    servers: z.array(McpServerSummarySchema),
  })
  .strict()

export const McpServerResponseSchema = z
  .object({
    server: McpServerSummarySchema,
  })
  .strict()

export const McpToolSummarySchema = z
  .object({
    name: z.string().min(1).max(MCP_PUBLIC_TOOL_NAME_MAX_LENGTH),
    rawName: z.string().min(1),
    serverId: z.string().min(1),
    serverSlug: z.string().regex(MCP_SERVER_SLUG_PATTERN),
    serverName: z.string().min(1),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    readOnly: z.boolean(),
    requiresApproval: z.boolean(),
  })
  .strict()

export const McpProbeResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      server: z
        .object({
          name: z.string().optional(),
          version: z.string().optional(),
        })
        .strict(),
      tools: z.array(McpToolSummarySchema),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      stage: z.enum(['connect', 'list']),
      message: z.string(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
])

export const McpToolsResponseSchema = z
  .object({
    tools: z.array(McpToolSummarySchema),
  })
  .strict()

export const McpToolCallRequestSchema = z
  .object({
    serverId: z.string().min(1),
    rawName: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
    approved: z.boolean(),
  })
  .strict()

export const McpToolCallResponseSchema = z
  .object({
    content: z.array(
      z
        .object({
          type: z.literal('text'),
          text: z.string(),
        })
        .strict()
    ),
    isError: z.boolean(),
  })
  .strict()

export const McpOAuthStartResponseSchema = z
  .object({
    authorizationUrl: z.string().url(),
  })
  .strict()

export const McpRegistryRemoteSchema = z
  .object({
    url: z.string().url(),
    requiredHeaderNames: z.array(HeaderNameSchema).max(32),
    requiresAuthentication: z.boolean(),
  })
  .strict()

export const McpRegistryServerSchema = z
  .object({
    registryName: z.string().min(1).max(512),
    publisher: z.string().min(1).max(256),
    title: z.string().min(1).max(200),
    description: z.string().max(4000),
    version: z.string().min(1).max(128),
    updatedAt: z.string().nullable(),
    repositoryUrl: z.string().url().nullable(),
    remotes: z.array(McpRegistryRemoteSchema).min(1).max(10),
  })
  .strict()

export const McpRegistryServersResponseSchema = z
  .object({
    servers: z.array(McpRegistryServerSchema),
    nextCursor: z.string().nullable(),
    search: z.string(),
  })
  .strict()

export type McpHeaders = z.infer<typeof McpHeadersSchema>
export type McpAuthMode = z.infer<typeof McpAuthModeSchema>
export type McpTrustMode = z.infer<typeof McpTrustModeSchema>
export type McpServerInput = z.infer<typeof McpServerInputSchema>
export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>
export type McpToolSummary = z.infer<typeof McpToolSummarySchema>
export type McpProbeResponse = z.infer<typeof McpProbeResponseSchema>
export type McpToolCallRequest = z.infer<typeof McpToolCallRequestSchema>
export type McpToolCallResponse = z.infer<typeof McpToolCallResponseSchema>
export type McpOAuthStartResponse = z.infer<typeof McpOAuthStartResponseSchema>
export type McpRegistryRemote = z.infer<typeof McpRegistryRemoteSchema>
export type McpRegistryServer = z.infer<typeof McpRegistryServerSchema>
export type McpRegistryServersResponse = z.infer<typeof McpRegistryServersResponseSchema>
