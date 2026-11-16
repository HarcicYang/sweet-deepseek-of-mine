import { Button } from '../base/Button.js'
import { BrandMark } from '../base/BrandMark.js'
import { useTranslate } from '../../i18n/index.js'
import { initAuth, loginWithGithub, useAuth } from '../../services/auth/store.js'
import styles from './LoginView.module.css'

export const LoginView = () => {
  const t = useTranslate()
  const status = useAuth((state) => state.status)
  const notice = useAuth((state) => state.notice)

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-live="polite">
        <div className={styles.brand}>
          <BrandMark variant="app" className={styles.brandMark} />
          <span>{"Sweet DeepSeek O'Mine"}</span>
        </div>
        <h1 className={styles.title}>{t('loginTitle')}</h1>
        <p className={styles.description}>{t('loginDescription')}</p>
        {status === 'loading' ? (
          <div className={styles.loading} role="status">
            {t('loginCheckingSession')}
          </div>
        ) : (
          <>
            {notice || status === 'error' ? (
              <div className={styles.notice} role="alert">
                {t(
                  status === 'error'
                    ? 'loginLoadFailed'
                    : notice === 'session_expired'
                      ? 'loginSessionExpired'
                      : notice === 'network_error'
                        ? 'loginNetworkError'
                        : 'loginOAuthFailed'
                )}
              </div>
            ) : null}
            {status === 'error' ? (
              <Button block onClick={() => void initAuth()}>
                {t('retry')}
              </Button>
            ) : (
              <Button block onClick={loginWithGithub}>
                {t('loginWithGithub')}
              </Button>
            )}
          </>
        )}
        <p className={styles.privacy}>{t('loginPrivacy')}</p>
      </section>
    </main>
  )
}
