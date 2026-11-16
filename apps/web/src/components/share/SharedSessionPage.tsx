import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getSharedSession } from '../../services/api/client.js'
import { fromSharedSessionPayload } from '../../services/share.js'
import type { Session } from '../../services/chat/types.js'
import { SessionView } from '../session/SessionView.js'
import styles from './SharedSessionPage.module.css'

type ShareState =
  | { status: 'loading' }
  | { status: 'ready'; session: Session; expiresAt: string }
  | { status: 'error' }

export const SharedSessionPage = ({ token }: { token: string }) => {
  const t = useTranslate()
  const [state, setState] = useState<ShareState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    getSharedSession(token, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'ready',
            session: fromSharedSessionPayload(response.share.session),
            expiresAt: response.share.expiresAt,
          })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: 'error' })
        }
      })
    return () => controller.abort()
  }, [token])

  if (state.status === 'loading') {
    return (
      <div className={styles.page} role="status">
        <div className={styles.status}>{t('shareLoading')}</div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={styles.page} role="alert">
        <div className={styles.status}>{t('shareUnavailable')}</div>
      </div>
    )
  }
  return (
    <div className={styles.page}>
      <SessionView
        session={state.session}
        streaming={false}
        siderCollapsed={false}
        readOnly
        shareExpiresAt={state.expiresAt}
      />
    </div>
  )
}
