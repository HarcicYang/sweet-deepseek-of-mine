import { useState } from 'react'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { useAuth, signOut } from '../../services/auth/store.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

export const AccountField = () => {
  const t = useTranslate()
  const user = useAuth((state) => state.user)
  const [signingOut, setSigningOut] = useState(false)

  if (!user) {
    return null
  }

  const submit = async () => {
    if (signingOut) {
      return
    }
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      showToast({ key: 'accountLogoutFailed', type: 'error' })
      setSigningOut(false)
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.accountRow}>
        {user.avatarUrl ? (
          <img
            className={styles.accountAvatar}
            src={user.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.accountAvatar}>{user.githubLogin.slice(0, 1).toUpperCase()}</span>
        )}
        <div className={styles.accountText}>
          <div className={styles.label}>{t('accountGithub')}</div>
          <div className={styles.description}>
            {t('accountSignedInAs', { login: user.githubLogin })}
          </div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={signingOut}
          onClick={() => void submit()}
        >
          {t(signingOut ? 'accountSigningOut' : 'accountSignOut')}
        </Button>
      </div>
    </div>
  )
}
