import clsx from 'clsx'
import { useDeferredValue, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ThinkingMode } from '@sweet-deepseek/contracts'
import { IconCheckOutline16, IconChevronDownOutline14, IconThinkOutline14 } from '../base/icons.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ModelThinkingMenu.module.css'

type ModelChoice = {
  value: string
  label: string
}

export const ModelThinkingMenu = ({
  currentModelValue,
  modelOptions,
  thinkingMode,
  thinkingOptions,
  onModelChange,
  onThinkingChange,
}: {
  currentModelValue: string
  modelOptions: ModelChoice[]
  thinkingMode: ThinkingMode
  thinkingOptions: ThinkingMode[]
  onModelChange: (value: string) => void
  onThinkingChange: (value: ThinkingMode) => void
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, {
    side: 'top',
    align: 'start',
    offset: 6,
    maxHeight: 460,
    minSpace: 220,
  })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const visibleModels = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase()
    const matched = normalized
      ? modelOptions.filter((option) =>
          `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalized)
        )
      : modelOptions
    return matched
  }, [deferredQuery, modelOptions])

  const currentModel = modelOptions.find((option) => option.value === currentModelValue)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, thinkingMode !== 'disabled' && styles.triggerActive)}
        aria-label={t('thinkingMode')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconThinkOutline14 />
        <span>{t(thinkingLabel(thinkingMode))}</span>
        <IconChevronDownOutline14 />
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="dialog"
              aria-label={t('modelThinkingMenu')}
            >
              <div className={styles.modelSection}>
                <div className={styles.sectionTitle}>{t('modelProvider')}</div>
                <div className={styles.currentModel}>
                  {currentModel?.label ?? t('modelProviderSelect')}
                </div>
                <input
                  className={styles.search}
                  value={query}
                  placeholder={t('modelSearchPlaceholder')}
                  aria-label={t('modelSearchPlaceholder')}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className={styles.modelList} role="listbox" aria-label={t('modelProvider')}>
                  {visibleModels.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={option.value === currentModelValue}
                      className={clsx(
                        styles.modelOption,
                        option.value === currentModelValue && styles.selected
                      )}
                      onClick={() => onModelChange(option.value)}
                    >
                      <span>{option.label}</span>
                      {option.value === currentModelValue ? <IconCheckOutline16 /> : null}
                    </button>
                  ))}
                  {visibleModels.length === 0 ? (
                    <div className={styles.empty}>{t('modelSearchEmpty')}</div>
                  ) : null}
                </div>
              </div>
              <div className={styles.thinkingSection}>
                <div className={styles.sectionTitle}>{t('thinkingMode')}</div>
                <div className={styles.thinkingOptions} role="radiogroup" aria-label={t('thinkingMode')}>
                  {thinkingOptions.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={thinkingMode === mode}
                      className={clsx(
                        styles.thinkingOption,
                        thinkingMode === mode && styles.selected
                      )}
                      onClick={() => {
                        onThinkingChange(mode)
                        setOpen(false)
                      }}
                    >
                      <span>{t(thinkingLabel(mode))}</span>
                      {thinkingMode === mode ? <IconCheckOutline16 /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

const thinkingLabel = (mode: ThinkingMode) =>
  mode === 'disabled'
    ? ('thinkingModeDisabled' as const)
    : mode === 'low'
      ? ('thinkingModeLow' as const)
      : mode === 'high'
        ? ('thinkingModeHigh' as const)
        : ('thinkingModeMax' as const)
