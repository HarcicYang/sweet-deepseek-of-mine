import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { syncNow, useSync, type SyncStatus as SyncStatusValue } from '../../services/sync/engine.js'
import styles from './SyncStatus.module.css'

const LABEL_KEYS = {
  idle: 'syncStatusIdle',
  syncing: 'syncStatusSyncing',
  synced: 'syncStatusSynced',
  offline: 'syncStatusOffline',
  conflict: 'syncStatusConflict',
  error: 'syncStatusError',
} as const satisfies Record<SyncStatusValue, TranslationKey>

export const SyncStatus = () => {
  const t = useTranslate()
  const status = useSync((state) => state.status)
  const error = useSync((state) => state.error)
  const retryable = status === 'offline' || status === 'error' || status === 'conflict'
  return (
    <button
      type="button"
      className={styles.status}
      data-status={status}
      title={status === 'offline' ? undefined : error ?? undefined}
      disabled={status === 'syncing'}
      onClick={retryable ? () => void syncNow() : undefined}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span>{t(LABEL_KEYS[status])}</span>
    </button>
  )
}
