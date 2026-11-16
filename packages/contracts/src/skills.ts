import { z } from 'zod'

export const SKILL_NAME_MAX_LENGTH = 64
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
export const SKILL_DESCRIPTION_MAX_LENGTH = 2_000
export const SKILL_SOURCE_MAX_LENGTH = 64 * 1024
export const SKILL_INSTRUCTIONS_MAX_LENGTH = 60 * 1024
export const SKILL_ENTRYPOINT = 'SKILL.md'
export const SKILL_MAX_FILES = 128
export const SKILL_FILE_MAX_LENGTH = 256 * 1024
export const SKILL_BUNDLE_MAX_BYTES = 512 * 1024

export const isSafeSkillFilePath = (value: string): boolean => {
  if (
    !value ||
    value.length > 240 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    return false
  }
  return value
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !['.git', '.dsh', '.agents', 'node_modules'].includes(segment.toLowerCase())
    )
}

export const SkillFilePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(isSafeSkillFilePath, 'Unsafe skill file path')

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
  instructions: z.string().min(1).max(SKILL_INSTRUCTIONS_MAX_LENGTH),
  files: z
    .array(
      z
        .object({
          path: SkillFilePathSchema,
          mediaType: z.string().min(1).max(200),
          sizeBytes: z.number().int().nonnegative(),
          content: z.string().max(SKILL_FILE_MAX_LENGTH),
        })
        .strict()
    )
    .min(1)
    .max(SKILL_MAX_FILES),
}).strict()

export const SkillFileInputSchema = z
  .object({
    path: SkillFilePathSchema,
    content: z.string().max(SKILL_FILE_MAX_LENGTH),
  })
  .strict()

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
    files: z.array(SkillFileInputSchema).min(1).max(SKILL_MAX_FILES),
    enabled: z.boolean().default(true),
  })
  .strict()

export const SkillUpdateSchema = z
  .object({
    files: z.array(SkillFileInputSchema).min(1).max(SKILL_MAX_FILES).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.files !== undefined || value.enabled !== undefined, {
    message: 'At least one field is required',
  })

export type SkillSummary = z.infer<typeof SkillSummarySchema>
export type SkillDetail = z.infer<typeof SkillDetailSchema>
export type SkillFileInput = z.infer<typeof SkillFileInputSchema>
export type SkillCreate = z.infer<typeof SkillCreateSchema>
export type SkillUpdate = z.infer<typeof SkillUpdateSchema>
