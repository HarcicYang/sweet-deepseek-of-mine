import { useEffect, useMemo, useState } from 'react'
import { parseJsonRenderSource, type JsonRenderDocument } from '@sweet-deepseek/json-render'
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
  const [document, setDocument] = useState<JsonRenderDocument | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setDocument(null)
    setFailed(false)
    if (limited) {
      return
    }
    if (!local.success) {
      setFailed(!streaming)
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
          setFailed(true)
        }
      })
    return () => {
      active = false
    }
  }, [limited, local, source, streaming])

  if (limited) {
    return (
      <details className={styles.fallback}>
        <summary>{t('jsonRenderLimitReached')}</summary>
        <pre>{source}</pre>
      </details>
    )
  }

  if (failed) {
    return (
      <details className={styles.fallback}>
        <summary>{t('jsonRenderInvalid')}</summary>
        <pre>{source}</pre>
      </details>
    )
  }
  if (!local.success && streaming) {
    return <JsonRenderPending />
  }
  if (!document) {
    return <JsonRenderPending />
  }
  return <JsonRenderView document={document} sessionId={sessionId} interactive={interactive} />
}
