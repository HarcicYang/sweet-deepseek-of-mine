import { z } from 'zod'

export const SKILL_NAME_MAX_LENGTH = 64
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
export const SKILL_DESCRIPTION_MAX_LENGTH = 2_000
export const SKILL_SOURCE_MAX_LENGTH = 64 * 1024
export const SKILL_INSTRUCTIONS_MAX_LENGTH = 60 * 1024

export const SkillSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().regex(SKILL_NAME_PATTERN),
    description: z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH),
    whenToUse: z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH).nullable(),
    enabled: z.boolean(),
    userInvocable: z.boolean(),
    modelInvocable: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

export const SkillDetailSchema = SkillSummarySchema.extend({
  source: z.string().min(1).max(SKILL_SOURCE_MAX_LENGTH),
  instructions: z.string().min(1).max(SKILL_INSTRUCTIONS_MAX_LENGTH),
}).strict()

export const SkillsResponseSchema = z
  .object({
    skills: z.array(SkillSummarySchema),
  })
  .strict()

export const SkillResponseSchema = z
  .object({
    skill: SkillDetailSchema,
  })
  .strict()

export const SkillCreateSchema = z
  .object({
    source: z.string().min(1).max(SKILL_SOURCE_MAX_LENGTH),
    enabled: z.boolean().default(true),
  })
  .strict()

export const SkillUpdateSchema = z
  .object({
    source: z.string().min(1).max(SKILL_SOURCE_MAX_LENGTH).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.source !== undefined || value.enabled !== undefined, {
    message: 'At least one field is required',
  })

export type SkillSummary = z.infer<typeof SkillSummarySchema>
export type SkillDetail = z.infer<typeof SkillDetailSchema>
export type SkillCreate = z.infer<typeof SkillCreateSchema>
export type SkillUpdate = z.infer<typeof SkillUpdateSchema>
