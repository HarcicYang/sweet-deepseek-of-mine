import { useEffect, useMemo, useState } from 'react'
import {
  parseJsonRenderSource,
  parsePartialJsonRenderSource,
  type JsonRenderDocument,
} from '@sweet-deepseek/json-render'
import { useTranslate } from '../../i18n/index.js'
import { validateJsonRenderSource } from '../../services/api/client.js'
import { JsonRenderPending } from './JsonRenderPending.js'
import { JsonRenderView } from './JsonRenderView.js'
import styles from './JsonRender.module.css'

export const JsonRenderBlock = ({
  source,
  sessionId,
  interactive,
  streaming,
  limited = false,
}: {
  source: string
  sessionId: string
  interactive: boolean
  streaming: boolean
  limited?: boolean
}) => {
  const t = useTranslate()
  const local = useMemo(() => parseJsonRenderSource(source), [source])
  const partial = useMemo(() => parsePartialJsonRenderSource(source), [source])
  const [document, setDocument] = useState<JsonRenderDocument | null>(null)
  const [validationFailed, setValidationFailed] = useState(false)

  useEffect(() => {
    setDocument(null)
    setValidationFailed(false)
    if (limited) {
      return
    }
    if (!local.success) {
      return
    }
    let active = true
    validateJsonRenderSource(source)
      .then((validated) => {
        if (active) {
          setDocument(validated)
        }
      })
      .catch(() => {
        if (active) {
          setValidationFailed(true)
        }
      })
    return () => {
      active = false
    }
  }, [limited, local, source])

  if (limited) {
    return (
      <details className={styles.fallback}>
        <summary>{t('jsonRenderLimitReached')}</summary>
        <pre>{source}</pre>
      </details>
    )
  }

  if (document) {
    return <JsonRenderView document={document} sessionId={sessionId} interactive={interactive} />
  }
  const preview = local.success ? local.data : partial?.success ? partial.data : null
  if (preview) {
    return (
      <div className={styles.partialPreview}>
        {validationFailed ? (
          <div className={styles.partialNotice} role="status">
            {t('jsonRenderPreviewOnly')}
          </div>
        ) : streaming || !local.success ? (
          <div className={styles.partialNotice} role="status">
            {t('jsonRenderPartialPreview')}
          </div>
        ) : null}
        <JsonRenderView document={preview} sessionId={sessionId} interactive={false} />
      </div>
    )
  }
  if (!streaming && !local.success) {
    return (
      <details className={styles.fallback}>
        <summary>{t('jsonRenderInvalid')}</summary>
        <pre>{source}</pre>
      </details>
    )
  }
  return <JsonRenderPending />
}
