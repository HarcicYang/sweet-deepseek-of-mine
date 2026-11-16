import { IconMenuOutline20, IconNewChatOutline20, IconShareOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题与开启新对话 */
export const MobileHeader = ({
  title,
  readOnly = false,
  onShare,
  shareDisabled = false,
}: {
  title?: string
  readOnly?: boolean
  onShare?: () => void
  shareDisabled?: boolean
}) => {
  const t = useTranslate()
  if (readOnly) {
    return (
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
      </div>
    )
  }
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : (
        <>
          <div className={styles.title}>{title}</div>
          {onShare ? (
            <IconButton
              size="xl"
              tone="primary"
              icon={<IconShareOutline16 />}
              aria-label={t('shareButton')}
              disabled={shareDisabled}
              onClick={onShare}
            />
          ) : null}
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
        </>
      )}
    </div>
  )
}
