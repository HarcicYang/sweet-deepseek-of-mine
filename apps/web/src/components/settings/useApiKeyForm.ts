import { useState } from 'react'
import { ApiError, saveDeepSeekKey } from '../../services/api/client.js'
import { setApiKeyConfigured } from '../../services/auth/store.js'
import { classifyApiError } from '../../services/api/errors.js'
import { useTranslate } from '../../i18n/index.js'

/** 输入 API Key 后由服务端验证并加密保存，浏览器不保留明文。 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : cause instanceof ApiError && cause.code === 'invalid_api_key'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      await saveDeepSeekKey(apiKey)
      setApiKeyConfigured(true)
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}
