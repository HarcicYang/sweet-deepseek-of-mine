import { memo, useEffect, useId, useState } from 'react'
import clsx from 'clsx'
import type {
  JsonRenderAction,
  JsonRenderBadge,
  JsonRenderBoxNode,
  JsonRenderCardItem,
  JsonRenderChartNode,
  JsonRenderColNode,
  JsonRenderDetailsNode,
  JsonRenderDividerNode,
  JsonRenderDocument,
  JsonRenderFormField,
  JsonRenderFormNode,
  JsonRenderIconNode,
  JsonRenderImageNode,
  JsonRenderListNode,
  JsonRenderNode,
  JsonRenderRowNode,
  JsonRenderSelectNode,
  JsonRenderSpacerNode,
  JsonRenderStatsNode,
  JsonRenderStepsNode,
  JsonRenderTransitionNode,
} from '@sweet-deepseek/json-render'
import { useTranslate } from '../../i18n/index.js'
import { sendPromptFromRender } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconExpandOutline16,
  IconLinkOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
  IconWarningOutline16,
} from '../base/icons.js'
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

const badgeColorClass = {
  secondary: styles.badgeSecondary,
  success: styles.badgeSuccess,
  danger: styles.badgeDanger,
  warning: styles.badgeWarning,
  info: styles.badgeInfo,
  discovery: styles.badgeDiscovery,
} as const

const badgeVariantClass = {
  solid: styles.badgeSolid,
  soft: styles.badgeSoft,
  outline: styles.badgeOutline,
} as const

const iconComponent = {
  check: IconCheckOutline16,
  close: IconCloseOutline16,
  copy: IconCopyOutline16,
  download: IconDownloadOutline16,
  edit: IconEditOutline16,
  expand: IconExpandOutline16,
  link: IconLinkOutline16,
  refresh: IconRefreshOutline16,
  search: IconSearchOutline16,
  settings: IconSettingsOutline16,
  upload: IconUploadOutline14,
  warning: IconWarningOutline16,
} as const

const iconColorClass = {
  primary: styles.iconPrimary,
  secondary: styles.iconSecondary,
  tertiary: styles.iconTertiary,
  brand: styles.iconBrand,
  success: styles.iconSuccess,
  warning: styles.iconWarning,
  danger: styles.iconDanger,
} as const

const iconSizeClass = {
  s: styles.iconS,
  m: styles.iconM,
  l: styles.iconL,
} as const

const seriesClass = (index: number) =>
  [styles.series0, styles.series1, styles.series2, styles.series3][index % 4]

const BadgeView = ({ badge, className }: { badge: JsonRenderBadge; className?: string }) => (
  <span
    className={clsx(
      styles.badge,
      badgeColorClass[badge.color ?? 'secondary'],
      badgeVariantClass[badge.variant ?? 'soft'],
      badge.pill && styles.badgePill,
      className
    )}
  >
    {badge.label}
  </span>
)

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
  compact,
}: {
  action: JsonRenderAction
  sessionId: string
  interactive: boolean
  primary: boolean
  compact?: boolean
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
      size={compact ? 's' : 'm'}
      className={compact ? styles.rowAction : styles.actionButton}
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
      <span className={styles.actionLabel}>{label}</span>
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
    {item.eyebrow || item.badge ? (
      <div className={styles.cardKicker}>
        {item.eyebrow ? <div className={styles.eyebrow}>{item.eyebrow}</div> : null}
        {item.badge ? <BadgeView badge={item.badge} /> : null}
      </div>
    ) : null}
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
    {item.content?.length ? (
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
    ) : null}
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

const StatsView = ({ node }: { node: JsonRenderStatsNode }) => (
  <div className={styles.stats}>
    {node.items.map((item, index) => (
      <div className={styles.stat} key={`${item.label}-${index}`}>
        <div className={styles.statLabel}>{item.label}</div>
        <div className={styles.statValue}>{item.value}</div>
        {item.detail ? <div className={styles.statDetail}>{item.detail}</div> : null}
      </div>
    ))}
  </div>
)

const StepsView = ({ node }: { node: JsonRenderStepsNode }) => {
  const t = useTranslate()
  const statusLabel = {
    pending: t('jsonRenderStepPending'),
    active: t('jsonRenderStepActive'),
    done: t('jsonRenderStepDone'),
    error: t('jsonRenderStepError'),
  }
  return (
    <ol className={styles.steps}>
      {node.items.map((item, index) => (
        <li key={`${item.title}-${index}`} data-status={item.status}>
          <span className={styles.stepMarker} aria-label={statusLabel[item.status]}>
            <span aria-hidden="true">
              {item.status === 'done'
                ? '✓'
                : item.status === 'error'
                  ? '!'
                  : item.status === 'active'
                    ? '•'
                    : ''}
            </span>
          </span>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>{item.title}</div>
            {item.description ? (
              <Markdown
                content={item.description.value}
                loading={false}
                cacheKey={`step-${index}`}
                disableLink={false}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

const DetailsView = ({ node }: { node: JsonRenderDetailsNode }) => (
  <details className={styles.details} open={node.open}>
    <summary>{node.title}</summary>
    <div className={styles.detailsBody}>
      <Markdown
        content={node.content.value}
        loading={false}
        cacheKey={`details-${node.title}`}
        disableLink={false}
      />
    </div>
  </details>
)

const ListNodeView = ({
  node,
  context,
  path,
}: {
  node: JsonRenderListNode
  context: RenderContext
  path: string
}) => (
  <section className={styles.list}>
    {node.title ? <div className={styles.listTitle}>{node.title}</div> : null}
    <ul className={styles.listItems}>
      {node.items.map((item, index) => (
        <li className={styles.listItem} key={`${path}-list-${index}-${item.title}`}>
          <div className={styles.listItemBody}>
            <div className={styles.listItemHeading}>
              <span className={styles.listItemTitle}>{item.title}</span>
              {item.badge ? <BadgeView badge={item.badge} /> : null}
            </div>
            {item.description ? (
              <div className={styles.listItemDescription}>{item.description}</div>
            ) : null}
            {item.meta ? <div className={styles.listItemMeta}>{item.meta}</div> : null}
          </div>
          {item.action ? (
            <JsonActionButton
              action={item.action}
              sessionId={context.sessionId}
              interactive={context.interactive}
              primary={false}
              compact
            />
          ) : null}
        </li>
      ))}
    </ul>
  </section>
)

const imageAspectClass = {
  auto: styles.imageAuto,
  landscape: styles.imageLandscape,
  square: styles.imageSquare,
  portrait: styles.imagePortrait,
} as const

const ImageView = ({ node }: { node: JsonRenderImageNode }) => {
  const t = useTranslate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [node.src])

  if (failed) {
    return (
      <div className={styles.imageFallback} role="status">
        {t('jsonRenderImageUnavailable')}
      </div>
    )
  }

  return (
    <figure className={clsx(styles.imageFigure, imageAspectClass[node.aspectRatio ?? 'landscape'])}>
      <img
        className={styles.image}
        src={node.src}
        alt={node.alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        data-fit={node.fit ?? 'cover'}
        onError={() => setFailed(true)}
      />
      {node.caption ? (
        <figcaption className={styles.imageCaption}>{node.caption}</figcaption>
      ) : null}
    </figure>
  )
}

const initialFormValues = (fields: JsonRenderFormField[]): Record<string, string> =>
  Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? '']))

const renderFormPrompt = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/gu, (_, name: string) => values[name] ?? '')

const FormView = ({
  node,
  context,
  path,
}: {
  node: JsonRenderFormNode
  context: RenderContext
  path: string
}) => {
  const t = useTranslate()
  const formId = useId()
  const [values, setValues] = useState<Record<string, string>>(() => initialFormValues(node.fields))

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (!context.interactive) {
          return
        }
        if (node.fields.some((field) => field.required && !(values[field.name] ?? '').trim())) {
          showToast({ key: 'jsonRenderFormRequired' })
          return
        }
        const prompt = renderFormPrompt(node.promptTemplate, values)
        if (!sendPromptFromRender(context.sessionId, prompt)) {
          showToast({ key: 'jsonRenderFormSubmitFailed' })
        }
      }}
    >
      {node.title ? <div className={styles.formTitle}>{node.title}</div> : null}
      {node.description ? <div className={styles.formDescription}>{node.description}</div> : null}
      <div className={styles.formFields}>
        {node.fields.map((field, index) => {
          const fieldId = `${formId}-${index}`
          const descriptionId = field.description ? `${fieldId}-description` : undefined
          return (
            <div className={styles.formField} key={`${path}-form-${field.name}`}>
              <label className={styles.formLabel} htmlFor={fieldId}>
                {field.label}
                {field.required ? <span aria-hidden="true"> *</span> : null}
              </label>
              {field.description ? (
                <div className={styles.formFieldDescription} id={descriptionId}>
                  {field.description}
                </div>
              ) : null}
              {field.type === 'select' ? (
                <Select
                  id={fieldId}
                  value={values[field.name] ?? ''}
                  options={field.options ?? []}
                  placeholder={t('jsonRenderFormSelectPlaceholder')}
                  ariaLabel={field.label}
                  ariaDescribedby={descriptionId}
                  disabled={!context.interactive}
                  required={field.required}
                  block
                  variant="field"
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.name]: value }))
                  }
                />
              ) : field.type === 'date' ? (
                <input
                  className={styles.formControl}
                  id={fieldId}
                  type="date"
                  value={values[field.name] ?? ''}
                  min={field.min}
                  max={field.max}
                  required={field.required}
                  disabled={!context.interactive}
                  aria-describedby={descriptionId}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              ) : field.type === 'textarea' ? (
                <textarea
                  className={clsx(styles.formControl, styles.formTextarea)}
                  id={fieldId}
                  value={values[field.name] ?? ''}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={!context.interactive}
                  aria-describedby={descriptionId}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              ) : (
                <input
                  className={styles.formControl}
                  id={fieldId}
                  type="text"
                  value={values[field.name] ?? ''}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={!context.interactive}
                  aria-describedby={descriptionId}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              )}
            </div>
          )
        })}
      </div>
      <div className={styles.formActions}>
        <Button type="submit" size="s" disabled={!context.interactive}>
          {node.submitLabel}
        </Button>
      </div>
    </form>
  )
}

type LayoutNode = JsonRenderBoxNode | JsonRenderRowNode | JsonRenderColNode

const layoutDirection = (node: LayoutNode) =>
  node.type === 'Col' ? 'column' : node.type === 'Row' ? 'row' : node.direction

const LayoutView = ({
  node,
  context,
  path,
}: {
  node: LayoutNode
  context: RenderContext
  path: string
}) => (
  <div
    className={styles.layout}
    data-direction={layoutDirection(node)}
    data-gap={node.gap ?? 'none'}
    data-align={node.align ?? 'stretch'}
    data-justify={node.justify ?? 'start'}
    data-wrap={node.wrap === false ? 'nowrap' : 'wrap'}
    data-grow={node.grow ?? false}
    data-padding={node.padding ?? 'none'}
    data-background={node.background ?? 'none'}
    data-radius={node.radius ?? 'none'}
  >
    {node.children.map((child, index) => (
      <NodeView
        key={`${path}-layout-${index}-${child.type}`}
        node={child}
        context={context}
        path={`${path}-layout-${index}`}
      />
    ))}
  </div>
)

const TransitionView = ({
  node,
  context,
  path,
}: {
  node: JsonRenderTransitionNode
  context: RenderContext
  path: string
}) => (
  <div
    className={styles.transition}
    data-effect={node.effect ?? 'fade'}
    data-grow={node.grow ?? false}
  >
    <NodeView node={node.children[0]} context={context} path={`${path}-transition`} />
  </div>
)

const SpacerView = ({ node }: { node: JsonRenderSpacerNode }) => (
  <div
    className={styles.spacer}
    data-size={node.size ?? 'm'}
    data-grow={node.grow ?? true}
    aria-hidden="true"
  />
)

const DividerView = ({ node }: { node: JsonRenderDividerNode }) => (
  <hr
    className={styles.divider}
    data-orientation={node.orientation ?? 'horizontal'}
    data-spacing={node.spacing ?? 'm'}
  />
)

const IconView = ({ node }: { node: JsonRenderIconNode }) => {
  const Component = iconComponent[node.name]
  return (
    <span
      className={clsx(
        styles.icon,
        iconColorClass[node.color ?? 'secondary'],
        iconSizeClass[node.size ?? 'm']
      )}
      role={node.label ? 'img' : undefined}
      aria-label={node.label}
      aria-hidden={node.label ? undefined : true}
    >
      <Component />
    </span>
  )
}

const renderSelectPrompt = (
  template: string,
  option: JsonRenderSelectNode['options'][number]
): string =>
  template.replace(/\{\{(value|label)\}\}/gu, (_, field: string) =>
    field === 'label' ? option.label : option.value
  )

const StandaloneSelectView = ({
  node,
  context,
}: {
  node: JsonRenderSelectNode
  context: RenderContext
}) => {
  const t = useTranslate()
  const [value, setValue] = useState(node.defaultValue ?? '')
  return (
    <div className={styles.standaloneSelect}>
      <div className={styles.formLabel}>{node.label}</div>
      <Select
        value={value}
        options={node.options}
        placeholder={node.placeholder ?? t('jsonRenderFormSelectPlaceholder')}
        ariaLabel={node.label}
        disabled={!context.interactive}
        block
        variant="field"
        onChange={(next) => {
          setValue(next)
          const option = node.options.find((item) => item.value === next)
          if (!option || !context.interactive) {
            return
          }
          if (
            !sendPromptFromRender(
              context.sessionId,
              renderSelectPrompt(node.promptTemplate, option)
            )
          ) {
            showToast({ key: 'jsonRenderFormSubmitFailed' })
          }
        }}
      />
    </div>
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
    case 'Badge':
      return <BadgeView badge={node} />
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
    case 'Chart':
      return <ChartView node={node} />
    case 'Stats':
      return <StatsView node={node} />
    case 'Steps':
      return <StepsView node={node} />
    case 'Details':
      return <DetailsView node={node} />
    case 'List':
      return <ListNodeView node={node} context={context} path={path} />
    case 'Image':
      return <ImageView node={node} />
    case 'Form':
      return <FormView node={node} context={context} path={path} />
    case 'Divider':
      return <DividerView node={node} />
    case 'Icon':
      return <IconView node={node} />
    case 'Spacer':
      return <SpacerView node={node} />
    case 'Select':
      return <StandaloneSelectView node={node} context={context} />
    case 'Box':
    case 'Row':
    case 'Col':
      return <LayoutView node={node} context={context} path={path} />
    case 'Transition':
      return <TransitionView node={node} context={context} path={path} />
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
