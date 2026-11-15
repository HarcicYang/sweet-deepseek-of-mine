import { useMemo } from 'react'
import clsx from 'clsx'
import {
  extractJsonRenderSegments,
  markExcessJsonRenderSegments,
  type JsonRenderSegment,
} from '@sweet-deepseek/json-render'
import { useTranslate } from '../../i18n/index.js'
import type { Source } from '../../services/chat/view.js'
import { Markdown } from '../markdown/Markdown.js'
import { JsonRenderBlock } from './JsonRenderBlock.js'
import { JsonRenderPending } from './JsonRenderPending.js'
import styles from './JsonRender.module.css'

const segmentKey = (segment: JsonRenderSegment, index: number) => `${segment.type}-${index}`

/**
 * 主回答渲染入口：普通文本继续走 Markdown，完整的 json-render 块交给静态组件白名单。
 * 未闭合块在流式期间显示占位，避免把原始 JSON 当作正文展示。
 */
export const RichMarkdown = ({
  content,
  loading,
  sources,
  sessionId,
  busy,
  className,
}: {
  content: string
  loading: boolean
  sources?: Source[]
  sessionId: string
  busy: boolean
  className?: string
}) => {
  const t = useTranslate()
  const segments = useMemo(
    () => extractJsonRenderSegments(content, { final: !loading }),
    [content, loading]
  )
  const preparedSegments = useMemo(() => markExcessJsonRenderSegments(segments), [segments])

  if (segments.length === 1 && segments[0]?.type === 'markdown') {
    return (
      <Markdown
        className={className}
        content={segments[0].content}
        loading={loading}
        cacheKey={sessionId}
        disableLink={false}
        sources={sources}
      />
    )
  }

  return (
    <div className={clsx(styles.richRoot, className)}>
      {preparedSegments.map(({ segment, limited }, index) => {
        const key = segmentKey(segment, index)
        if (segment.type === 'markdown') {
          return (
            <Markdown
              key={key}
              content={segment.content}
              loading={loading && index === preparedSegments.length - 1}
              cacheKey={`${key}-${sessionId}`}
              disableLink={false}
              sources={sources}
            />
          )
        }
        if (segment.type === 'pending') {
          return <JsonRenderPending key={key} />
        }
        if (limited) {
          return (
            <details key={key} className={styles.fallback}>
              <summary>{t('jsonRenderLimitReached')}</summary>
              <pre>{segment.source}</pre>
            </details>
          )
        }
        return (
          <JsonRenderBlock
            key={key}
            source={segment.source}
            sessionId={sessionId}
            interactive={!loading && !busy}
          />
        )
      })}
    </div>
  )
}
