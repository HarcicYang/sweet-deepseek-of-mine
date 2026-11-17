import { useTranslate } from '../../i18n/index.js'
import { applyPwaUpdate, usePwa } from '../../services/pwa.js'
import { Button } from '../base/Button.js'
import styles from './PwaUpdateBanner.module.css'

export const PwaUpdateBanner = () => {
  const t = useTranslate()
  const updateReady = usePwa((state) => state.updateReady)
  if (!updateReady) {
    return null
  }
  return (
    <div className={styles.banner} role="status">
      <span>{t('pwaUpdateAvailable')}</span>
      <Button size="s" variant="outlined" onClick={applyPwaUpdate}>
        {t('pwaRefresh')}
      </Button>
    </div>
  )
}
