import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { createShare } from '../../services/api/client.js'
import { isOffline } from '../../services/auth/store.js'
import { copyText } from '../../utils/clipboard.js'
import { toShareSessionPayload } from '../../services/share.js'
import type { Session } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './ShareDialog.module.css'

export const ShareDialog = ({ session, onClose }: { session: Session; onClose: () => void }) => {
  const t = useTranslate()
  const [days, setDays] = useState(3)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<{
    url: string
    expiresAt: string
  } | null>(null)
  const validDays = Number.isInteger(days) && days >= 1 && days <= 30

  const create = async () => {
    if (!validDays || pending) {
      return
    }
    if (isOffline()) {
      setError(t('offlineActionUnavailable'))
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await createShare(toShareSessionPayload(session), days)
      setShare({ url: result.share.url, expiresAt: result.share.expiresAt })
    } catch {
      setError(t('shareCreateFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      title={t('shareDialogTitle')}
      closable={!pending}
      onClose={() => {
        if (!pending) {
          onClose()
        }
      }}
      mainClassName={styles.main}
      footer={
        share ? (
          <>
            <Button variant="outlined" onClick={onClose}>
              {t('close')}
            </Button>
            <Button
              onClick={async () => {
                if (await copyText(share.url)) {
                  showToast({ key: 'copied' })
                } else {
                  showToast({ key: 'copyFailed' })
                }
              }}
            >
              {t('copyShareLink')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outlined" disabled={pending} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button disabled={!validDays || pending} onClick={() => void create()}>
              {t('createShareLink')}
            </Button>
          </>
        )
      }
    >
      {share ? (
        <>
          <p className={styles.description}>{t('shareLinkReady')}</p>
          <label className={styles.label} htmlFor="sdom-share-url">
            {t('shareLinkLabel')}
          </label>
          <input
            id="sdom-share-url"
            className={styles.link}
            readOnly
            value={share.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className={styles.expiry}>
            {t('shareExpiresAt', {
              date: new Date(share.expiresAt).toLocaleString(),
            })}
          </p>
          <p className={styles.notice}>{t('shareReadOnlyNotice')}</p>
        </>
      ) : (
        <>
          <p className={styles.description}>{t('shareDialogDescription')}</p>
          <label className={styles.label} htmlFor="sdom-share-days">
            {t('shareDurationLabel')}
          </label>
          <div className={styles.duration}>
            <input
              id="sdom-share-days"
              className={styles.days}
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
            <span>{t('shareDaysUnit')}</span>
          </div>
          <p className={styles.hint}>{t('shareDurationHint')}</p>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </Modal>
  )
}
