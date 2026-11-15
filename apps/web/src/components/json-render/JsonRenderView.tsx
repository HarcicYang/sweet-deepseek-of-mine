import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'
import type {
  JsonRenderAction,
  JsonRenderCardItem,
  JsonRenderChartNode,
  JsonRenderDocument,
  JsonRenderNode,
  JsonRenderTableNode,
} from '@sweet-deepseek/json-render'
import { useTranslate } from '../../i18n/index.js'
import { sendPromptFromRender } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { IconCheckOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { CodeBlock } from '../markdown/CodeBlock.js'
import { Markdown } from '../markdown/Markdown.js'
import styles from './JsonRender.module.css'

type RenderContext = {
  sessionId: string
  interactive: boolean
}

const toneClass = {
  info: styles.calloutInfo,
  success: styles.calloutSuccess,
  warning: styles.calloutWarning,
  danger: styles.calloutDanger,
} as const

const seriesClass = (index: number) =>
  [styles.series0, styles.series1, styles.series2, styles.series3][index % 4]

const ActionButtons = ({
  actions,
  sessionId,
  interactive,
}: {
  actions: JsonRenderAction[] | undefined
  sessionId: string
  interactive: boolean
}) => {
  if (!actions?.length) {
    return null
  }
  return (
    <div className={styles.actions}>
      {actions.map((action, index) => (
        <JsonActionButton
          key={`${action.kind}-${index}-${action.label}`}
          action={action}
          sessionId={sessionId}
          interactive={interactive}
          primary={index === 0}
        />
      ))}
    </div>
  )
}

const JsonActionButton = ({
  action,
  sessionId,
  interactive,
  primary,
}: {
  action: JsonRenderAction
  sessionId: string
  interactive: boolean
  primary: boolean
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const label = copied ? t('copied') : action.label
  return (
    <Button
      variant={primary ? 'primary' : 'outlined'}
      size="m"
      disabled={!interactive}
      onClick={async () => {
        if (action.kind === 'prompt') {
          sendPromptFromRender(sessionId, action.value)
          return
        }
        if (!(await copyText(action.value))) {
          showToast({ key: 'copyFailed' })
          return
        }
        setCopied(true)
      }}
    >
      {copied ? <IconCheckOutline16 /> : null}
      {label}
    </Button>
  )
}

const CardContent = ({
  item,
  context,
  path,
}: {
  item: JsonRenderCardItem
  context: RenderContext
  path: string
}) => (
  <>
    {item.eyebrow ? <div className={styles.eyebrow}>{item.eyebrow}</div> : null}
    {item.title ? <div className={styles.cardTitle}>{item.title}</div> : null}
    {item.description ? (
      <Markdown
        className={styles.cardDescription}
        content={item.description}
        loading={false}
        cacheKey={`${path}-description`}
        disableLink={false}
      />
    ) : null}
    <div className={styles.cardBody}>
      {item.content.map((node, index) => (
        <NodeView
          key={`${path}-${index}-${node.type}`}
          node={node}
          context={context}
          path={`${path}-${index}`}
        />
      ))}
    </div>
    <ActionButtons
      actions={item.actions}
      sessionId={context.sessionId}
      interactive={context.interactive}
    />
  </>
)

const Card = ({
  item,
  context,
  path,
  carousel = false,
}: {
  item: JsonRenderCardItem
  context: RenderContext
  path: string
  carousel?: boolean
}) => (
  <article className={clsx(styles.card, carousel && styles.carouselCard)}>
    <CardContent item={item} context={context} path={path} />
  </article>
)

const TableView = ({ node }: { node: JsonRenderTableNode }) => (
  <figure className={styles.tableFigure}>
    <div className={styles.tableScroll}>
      <table>
        {node.title ? <caption>{node.title}</caption> : null}
        <thead>
          <tr>
            {node.columns.map((column, index) => (
              <th key={`${column.label}-${index}`} style={{ textAlign: column.align ?? 'left' }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ textAlign: node.columns[cellIndex]?.align ?? 'left' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </figure>
)

const formatValue = (value: number) => {
  const rounded = Math.round(value * 100) / 100
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(rounded)
}

const ChartView = ({ node }: { node: JsonRenderChartNode }) => {
  const t = useTranslate()
  const width = 640
  const height = 260
  const padding = { top: 20, right: 18, bottom: 42, left: 46 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const values = node.series.flatMap((series) => series.values)
  const minValue = Math.min(0, ...values)
  const maxValue = Math.max(0, ...values)
  const range = maxValue - minValue || 1
  const y = (value: number) => padding.top + ((maxValue - value) / range) * plotHeight
  const zeroY = y(0)
  const groupWidth = plotWidth / node.labels.length
  const labelStep = Math.max(1, Math.ceil(node.labels.length / 7))

  return (
    <figure className={styles.chartFigure}>
      {node.title ? <figcaption>{node.title}</figcaption> : null}
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={node.title ?? node.series.map((series) => series.name).join(', ')}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = padding.top + plotHeight * ratio
          return (
            <line
              key={ratio}
              className={styles.chartGrid}
              x1={padding.left}
              x2={width - padding.right}
              y1={lineY}
              y2={lineY}
            />
          )
        })}
        <line
          className={styles.chartAxis}
          x1={padding.left}
          x2={width - padding.right}
          y1={zeroY}
          y2={zeroY}
        />
        {node.kind === 'bar'
          ? node.series.map((series, seriesIndex) => {
              const barWidth = (groupWidth * 0.72) / node.series.length
              const groupOffset = groupWidth * 0.14
              return (
                <g key={series.name} className={seriesClass(seriesIndex)}>
                  {series.values.map((value, index) => {
                    const x =
                      padding.left + index * groupWidth + groupOffset + seriesIndex * barWidth
                    const top = Math.min(y(value), zeroY)
                    const bottom = Math.max(y(value), zeroY)
                    return (
                      <rect
                        key={index}
                        className={styles.chartBar}
                        x={x + 1}
                        y={top}
                        width={Math.max(1, barWidth - 2)}
                        height={Math.max(1, bottom - top)}
                        rx={3}
                      />
                    )
                  })}
                </g>
              )
            })
          : node.series.map((series, seriesIndex) => (
              <g key={series.name} className={seriesClass(seriesIndex)}>
                <polyline
                  className={styles.chartLine}
                  points={series.values
                    .map((value, index) => {
                      const x = padding.left + groupWidth * (index + 0.5)
                      return `${x},${y(value)}`
                    })
                    .join(' ')}
                />
                {series.values.map((value, index) => (
                  <circle
                    key={index}
                    className={styles.chartPoint}
                    cx={padding.left + groupWidth * (index + 0.5)}
                    cy={y(value)}
                    r={3}
                  />
                ))}
              </g>
            ))}
        {node.labels.map((label, index) =>
          index % labelStep === 0 ? (
            <text
              key={`${label}-${index}`}
              className={styles.chartLabel}
              x={padding.left + groupWidth * (index + 0.5)}
              y={height - 16}
              textAnchor="middle"
            >
              {label}
            </text>
          ) : null
        )}
        <text
          className={styles.chartLabel}
          x={padding.left - 8}
          y={padding.top + 4}
          textAnchor="end"
        >
          {formatValue(maxValue)}
          {node.unit ?? ''}
        </text>
        <text
          className={styles.chartLabel}
          x={padding.left - 8}
          y={height - padding.bottom + 4}
          textAnchor="end"
        >
          {formatValue(minValue)}
          {node.unit ?? ''}
        </text>
      </svg>
      {node.series.length > 1 || node.kind === 'line' ? (
        <div className={styles.legend}>
          {node.series.map((series, index) => (
            <span key={series.name}>
              <i className={seriesClass(index)} />
              {series.name}
            </span>
          ))}
        </div>
      ) : null}
      <table className={styles.srOnly}>
        <caption>{node.title ?? t('jsonRenderChart')}</caption>
        <thead>
          <tr>
            <th>Label</th>
            {node.series.map((series) => (
              <th key={series.name}>{series.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.labels.map((label, index) => (
            <tr key={`${label}-${index}`}>
              <th>{label}</th>
              {node.series.map((series) => (
                <td key={series.name}>{formatValue(series.values[index])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

const NodeView = ({
  node,
  context,
  path,
}: {
  node: JsonRenderNode
  context: RenderContext
  path: string
}) => {
  switch (node.type) {
    case 'Markdown':
      return <Markdown content={node.value} loading={false} cacheKey={path} disableLink={false} />
    case 'Code':
      return (
        <div className={styles.code}>
          {node.title ? <div className={styles.sectionTitle}>{node.title}</div> : null}
          <CodeBlock code={node.code} infostring={node.language ?? 'text'} />
        </div>
      )
    case 'Callout':
      return (
        <aside className={clsx(styles.callout, toneClass[node.tone])}>
          <span className={styles.calloutIcon} aria-hidden="true">
            {node.tone === 'success' ? '✓' : node.tone === 'info' ? 'i' : '!'}
          </span>
          <div>
            {node.title ? <div className={styles.calloutTitle}>{node.title}</div> : null}
            <Markdown
              content={node.content.value}
              loading={false}
              cacheKey={`${path}-callout`}
              disableLink={false}
            />
          </div>
        </aside>
      )
    case 'Table':
      return <TableView node={node} />
    case 'Chart':
      return <ChartView node={node} />
    case 'Stack':
      return (
        <div className={styles.stack} data-gap={node.gap ?? 'm'}>
          {node.children.map((child, index) => (
            <NodeView
              key={`${path}-stack-${index}`}
              node={child}
              context={context}
              path={`${path}-stack-${index}`}
            />
          ))}
        </div>
      )
    case 'Card':
      return <Card item={node} context={context} path={path} />
    case 'Carousel':
      return (
        <div className={styles.carousel} role="list">
          {node.items.map((item, index) => (
            <div role="listitem" key={`${path}-carousel-${index}`}>
              <Card item={item} context={context} path={`${path}-carousel-${index}`} carousel />
            </div>
          ))}
        </div>
      )
    default:
      return null
  }
}

export const JsonRenderView = memo(function JsonRenderView({
  document,
  sessionId,
  interactive,
}: {
  document: JsonRenderDocument
  sessionId: string
  interactive: boolean
}) {
  return (
    <div className={styles.renderRoot} data-json-render-version={document.version}>
      <NodeView node={document.root} context={{ sessionId, interactive }} path="root" />
    </div>
  )
})
