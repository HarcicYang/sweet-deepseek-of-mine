import { useState } from 'react'
import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { IconButton } from '../base/IconButton.js'
import { IconShareOutline16 } from '../base/icons.js'
import { MessageList } from '../messages/MessageList.js'
import { ShareDialog } from '../share/ShareDialog.js'
import { MobileHeader } from './MobileHeader.js'
import { useAuth } from '../../services/auth/store.js'
import { useSync } from '../../services/sync/engine.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
  readOnly = false,
  shareExpiresAt,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
  readOnly?: boolean
  shareExpiresAt?: string
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [shareOpen, setShareOpen] = useState(false)
  const offline =
    useAuth((state) => state.offline) || useSync((state) => state.status === 'offline')
  const title = session.title || t('untitledChat')
  const expiry = shareExpiresAt
    ? t('shareExpiresAt', {
        date: new Date(shareExpiresAt).toLocaleString(),
      })
    : null
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader
          title={title}
          readOnly={readOnly}
          onShare={readOnly ? undefined : () => setShareOpen(true)}
          shareDisabled={streaming || offline}
        />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          {expiry ? <div className={styles.expiry}>{expiry}</div> : null}
          {!readOnly ? (
            <IconButton
              icon={<IconShareOutline16 />}
              tooltip={t('shareButton')}
              tooltipPlacement="bottom"
              disabled={streaming || offline}
              onClick={() => setShareOpen(true)}
            />
          ) : null}
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        readOnly={readOnly}
        footer={
          readOnly ? null : (
            <div className={styles.inputContainer}>
              <ChatInput sessionId={session.id} />
              <div className={styles.caveat}>{t('contentCaveat')}</div>
            </div>
          )
        }
      />
      {shareOpen ? <ShareDialog session={session} onClose={() => setShareOpen(false)} /> : null}
    </div>
  )
}
