import clsx from 'clsx'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from './icons.js'
import styles from './Select.module.css'

export type SelectOption<T extends string> = { value: T; label: string; lang?: string }

/**
 * 胶囊形选择器：触发器高 36px、圆角 18px、浅灰底，下拉菜单选中项右侧打勾；
 * 支持方向键、Home/End、Enter/Space 与 Esc；点外部或 Esc 关闭。
 * value 不匹配任何选项时触发器显示 placeholder。
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  ariaDescribedby,
  className,
  disabled = false,
  id,
  required = false,
  block = false,
  variant = 'pill',
  startIcon,
  searchable = false,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  ariaDescribedby?: string
  className?: string
  disabled?: boolean
  id?: string
  required?: boolean
  block?: boolean
  variant?: 'pill' | 'field'
  startIcon?: ReactNode
  searchable?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const current = options.find((option) => option.value === value)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleOptions = searchable && normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalizedQuery)
      )
    : options
  const selectedIndex = visibleOptions.findIndex((option) => option.value === value)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex))
  const listboxId = useId()
  const field = variant === 'field'
  // 菜单贴右侧展开，最多 320px 高，超出在菜单内滚动
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: 'end', maxHeight: 320, minSpace: 160, matchAnchorWidth: field })
  // Esc 只关菜单，不让外层弹窗一起关闭
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const openMenu = () => {
    setQuery('')
    setActiveIndex(Math.max(0, selectedIndex))
    setOpen(true)
  }
  const selectOption = (index: number) => {
    const option = visibleOptions[index]
    if (!option) {
      return
    }
    setOpen(false)
    onChange(option.value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab' && open) {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (visibleOptions.length === 0) {
        return
      }
      if (!open) {
        openMenu()
        return
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => (index + delta + visibleOptions.length) % visibleOptions.length)
      return
    }
    if (!open) {
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, visibleOptions.length - 1))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOption(activeIndex)
    }
  }

  useEffect(() => {
    if (open && searchable) {
      searchRef.current?.focus()
    }
  }, [open, searchable])

  useEffect(() => {
    if (!open) {
      return
    }
    document
      .getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, listboxId, open])

  return (
    <>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        className={clsx(
          styles.trigger,
          field && styles.triggerField,
          block && styles.block,
          open && styles.open,
          className
        )}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && visibleOptions.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {startIcon ? <span className={styles.startIcon}>{startIcon}</span> : null}
        {current ? (
          <span className={styles.value} lang={current.lang}>
            {current.label}
          </span>
        ) : (
          <span className={clsx(styles.value, styles.placeholder)}>{placeholder}</span>
        )}
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              className={clsx(styles.menu, field && styles.menuField)}
              style={position ?? undefined}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
            >
              {searchable ? (
                <input
                  ref={searchRef}
                  className={styles.search}
                  value={query}
                  placeholder={placeholder}
                  aria-label={ariaLabel}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActiveIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      if (visibleOptions.length === 0) {
                        return
                      }
                      const delta = event.key === 'ArrowDown' ? 1 : -1
                      setActiveIndex((index) =>
                        (index + delta + visibleOptions.length) % visibleOptions.length
                      )
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      selectOption(activeIndex)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setOpen(false)
                    }
                  }}
                />
              ) : null}
              {visibleOptions.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  lang={option.lang}
                  aria-selected={option.value === value}
                  className={clsx(styles.option, index === activeIndex && styles.optionActive)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    selectOption(index)
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <IconCheckOutline16 /> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
