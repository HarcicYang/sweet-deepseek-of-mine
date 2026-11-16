import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconExpandOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './DataTable.module.css'

type Alignment = 'left' | 'center' | 'right' | null | undefined

const toTsv = (columns: string[], rows: string[][]) =>
  [columns, ...rows]
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n')

const csvCell = (value: string) => {
  const normalized = value.replace(/\r\n?/g, '\n')
  const safe = /^[=+\-@\t]/.test(normalized) ? `'${normalized}` : normalized
  return `"${safe.replaceAll('"', '""')}"`
}

const toCsv = (columns: string[], rows: string[][]) =>
  `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`

export const DataTable = ({
  title,
  columns,
  rows,
  plainColumns,
  plainRows,
  alignments,
}: {
  title?: string
  columns: ReactNode[]
  rows: ReactNode[][]
  plainColumns: string[]
  plainRows: string[][]
  alignments?: Alignment[]
}) => {
  const t = useTranslate()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const displayTitle = title || t('tableBlockTitle')

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(
    () => () => {
      dialogRef.current?.close()
    },
    []
  )

  const copyTable = async () => {
    if (!(await copyText(toTsv(plainColumns, plainRows)))) {
      showToast({ key: 'copyFailed' })
      return
    }
    setCopied(true)
  }

  const downloadTable = () => {
    const blob = new Blob([toCsv(plainColumns, plainRows)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${displayTitle.replace(/[\\/:*?"<>|]+/g, '-') || 'table'}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const toolbar = (expanded: boolean) => (
    <div className={styles.toolbar}>
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.tools}>
        <IconButton
          icon={copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
          tooltip={t(copied ? 'copied' : 'copy')}
          onClick={() => void copyTable()}
        />
        <IconButton
          icon={<IconDownloadOutline16 />}
          tooltip={t('downloadTable')}
          onClick={downloadTable}
        />
        <IconButton
          icon={expanded ? <IconCloseOutline16 /> : <IconExpandOutline16 />}
          tooltip={t(expanded ? 'closeTable' : 'expandTable')}
          onClick={() => {
            const dialog = dialogRef.current
            if (!dialog) {
              return
            }
            if (dialog.open) {
              dialog.close()
            } else {
              dialog.showModal()
            }
          }}
        />
      </div>
    </div>
  )

  const table = (
    <div className={styles.scroll}>
      <table>
        <caption className={styles.srOnly}>{displayTitle}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} style={{ textAlign: alignments?.[index] ?? 'left' }}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{ textAlign: alignments?.[cellIndex] ?? 'left' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      dialogRef.current?.close()
    }
  }

  return (
    <>
      <div className={styles.block}>
        {toolbar(false)}
        {table}
      </div>
      <dialog ref={dialogRef} className={styles.dialog} onClick={onDialogClick}>
        <div className={styles.dialogPanel}>
          {toolbar(true)}
          {table}
        </div>
      </dialog>
    </>
  )
}
