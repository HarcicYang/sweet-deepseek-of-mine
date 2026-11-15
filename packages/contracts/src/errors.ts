import type { ApiErrorBody } from './deepseek.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isOptionalNullableString = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string'

/** 校验上游错误体，只保留应用需要消费的字段。 */
export const readApiErrorBody = (value: unknown): ApiErrorBody | null => {
  if (!isRecord(value)) {
    return null
  }
  const error = value.error
  if (!isRecord(error) || typeof error.message !== 'string') {
    return null
  }
  if (
    !isOptionalString(error.type) ||
    !isOptionalNullableString(error.param) ||
    !isOptionalNullableString(error.code)
  ) {
    return null
  }
  return {
    error: {
      message: error.message,
      ...(error.type === undefined ? {} : { type: error.type as string }),
      ...(error.param === undefined ? {} : { param: error.param as string | null }),
      ...(error.code === undefined ? {} : { code: error.code as string | null }),
    },
  }
}
