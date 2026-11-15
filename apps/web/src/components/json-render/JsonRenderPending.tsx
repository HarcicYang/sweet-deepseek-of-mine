import { useTranslate } from '../../i18n/index.js'
import styles from './JsonRender.module.css'

export const JsonRenderPending = () => {
  const t = useTranslate()
  return (
    <div className={styles.pending} aria-live="polite">
      <span className={styles.pendingLabel}>{t('jsonRenderGenerating')}</span>
      <span className={styles.pendingLine} />
      <span className={styles.pendingLineShort} />
    </div>
  )
}
