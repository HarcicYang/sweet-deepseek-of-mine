import { z } from 'zod'

export const ProviderApiSchema = z.enum([
  'anthropic-messages',
  'azure-openai-responses',
  'bedrock-converse-stream',
  'google-generative-ai',
  'google-vertex',
  'mistral-conversations',
  'openai-completions',
  'openai-codex-responses',
  'openai-responses',
  'pi-messages',
])

export type ProviderApi = z.infer<typeof ProviderApiSchema>

export const ProviderAuthModeSchema = z.enum(['api_key', 'oauth'])

export type ProviderAuthMode = z.infer<typeof ProviderAuthModeSchema>

export const ModelThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type ModelThinkingLevel = z.infer<typeof ModelThinkingLevelSchema>

export const ModelInputSchema = z.enum(['text', 'image'])

export type ModelInput = z.infer<typeof ModelInputSchema>

export const ModelRefSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(256),
  })
  .strict()

export type ModelRef = z.infer<typeof ModelRefSchema>

export const ProviderModelSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
    api: ProviderApiSchema,
    contextWindow: z.number().int().positive().max(100_000_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    input: z.array(ModelInputSchema).min(1).max(2),
    reasoning: z.boolean(),
    thinkingLevels: z.array(ModelThinkingLevelSchema).max(7),
  })
  .strict()

export type ProviderModel = z.infer<typeof ProviderModelSchema>

export const ProviderTemplateSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    kind: z.enum(['builtin', 'custom']),
    authModes: z.array(ProviderAuthModeSchema).min(1),
    api: ProviderApiSchema.optional(),
    baseUrl: z.string().url().optional(),
  })
  .strict()

export type ProviderTemplate = z.infer<typeof ProviderTemplateSchema>

export const ProviderSummarySchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    kind: z.enum(['deepseek', 'builtin', 'custom']),
    authModes: z.array(ProviderAuthModeSchema).min(1),
    configured: z.boolean(),
    api: ProviderApiSchema.optional(),
    baseUrl: z.string().url().optional(),
    models: z.array(ProviderModelSchema).max(1_000),
  })
  .strict()

export type ProviderSummary = z.infer<typeof ProviderSummarySchema>

export const ProvidersResponseSchema = z
  .object({
    providers: z.array(ProviderSummarySchema),
    templates: z.array(ProviderTemplateSchema),
  })
  .strict()

export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>

export const ProviderModelInputSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(256).optional(),
    contextWindow: z.number().int().positive().max(100_000_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    input: z.array(ModelInputSchema).min(1).max(2),
    reasoning: z.boolean(),
    thinkingLevels: z.array(ModelThinkingLevelSchema).max(7),
  })
  .strict()

export type ProviderModelInput = z.infer<typeof ProviderModelInputSchema>

export const ProviderCreateRequestSchema = z
  .object({
    templateId: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(128).optional(),
    apiKey: z.string().trim().min(1).max(16_384),
    baseUrl: z.string().url().max(2_000).optional(),
    models: z.array(ProviderModelInputSchema).min(1).max(1_000).optional(),
  })
  .strict()

export type ProviderCreateRequest = z.infer<typeof ProviderCreateRequestSchema>

export const ProviderUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    apiKey: z.string().trim().min(1).max(16_384).nullable().optional(),
    baseUrl: z.string().url().max(2_000).nullable().optional(),
    models: z.array(ProviderModelInputSchema).min(1).max(1_000).optional(),
  })
  .strict()

export type ProviderUpdateRequest = z.infer<typeof ProviderUpdateRequestSchema>

export const ProviderResponseSchema = z.object({ provider: ProviderSummarySchema }).strict()

export type ProviderResponse = z.infer<typeof ProviderResponseSchema>
