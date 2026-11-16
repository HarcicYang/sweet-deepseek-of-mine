import { z } from 'zod'
import { SyncSessionPayloadSchema } from './sync.js'

export const SHARE_DEFAULT_DAYS = 3
export const SHARE_MIN_DAYS = 1
export const SHARE_MAX_DAYS = 30
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/u

export const ShareCreateRequestSchema = z
  .object({
    session: SyncSessionPayloadSchema,
    expiresInDays: z
      .number()
      .int()
      .min(SHARE_MIN_DAYS)
      .max(SHARE_MAX_DAYS)
      .default(SHARE_DEFAULT_DAYS),
  })
  .strict()

export type ShareCreateRequest = z.infer<typeof ShareCreateRequestSchema>

export const ShareLinkSchema = z
  .object({
    token: z.string().regex(SHARE_TOKEN_PATTERN),
    url: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const ShareCreateResponseSchema = z.object({ share: ShareLinkSchema }).strict()
export type ShareCreateResponse = z.infer<typeof ShareCreateResponseSchema>

export const SharedSessionSchema = z
  .object({
    session: SyncSessionPayloadSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const SharedSessionResponseSchema = z.object({ share: SharedSessionSchema }).strict()
export type SharedSessionResponse = z.infer<typeof SharedSessionResponseSchema>
