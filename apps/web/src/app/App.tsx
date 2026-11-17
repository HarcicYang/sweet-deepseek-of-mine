import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { initAuth, isOffline, useAuth } from '../services/auth/store.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  refreshChatFromStorage,
  retrySaveSessions,
  selectSession,
  stopAllReplies,
  useChatStore,
} from '../services/chat/store.js'
import { configureChatDatabase } from '../services/chat/db.js'
import { initSync, stopSyncScheduler, useSync } from '../services/sync/engine.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { LoginView } from '../components/auth/LoginView.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { closeSettings, ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { McpApprovalDialog } from '../components/mcp/McpApprovalDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { SharedSessionPage } from '../components/share/SharedSessionPage.js'
import { readShareToken } from '../services/share.js'
import { PwaUpdateBanner } from '../components/pwa/PwaUpdateBanner.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const authStatus = useAuth((state) => state.status)
  const authUser = useAuth((state) => state.user)
  const authUserId = authUser?.id
  const authOffline = useAuth((state) => state.offline)
  const syncStatus = useSync((state) => state.status)
  const offline = authOffline || syncStatus === 'offline'
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const shareToken = readShareToken()

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(() => {
    if (shareToken) {
      return
    }
    return bindChatPersistence()
  }, [shareToken])
  useEffect(() => {
    if (shareToken) {
      return
    }
    const onSyncApplied = () => void refreshChatFromStorage()
    const onSyncConflict = () => showToast({ key: 'syncConflictToast', type: 'error' })
    window.addEventListener('sdom:sync-applied', onSyncApplied)
    window.addEventListener('sdom:sync-conflict', onSyncConflict)
    return () => {
      window.removeEventListener('sdom:sync-applied', onSyncApplied)
      window.removeEventListener('sdom:sync-conflict', onSyncConflict)
    }
  }, [shareToken])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    if (!shareToken) {
      void initAuth()
    }
  }, [shareToken])

  useEffect(() => {
    let cancelled = false
    if (authStatus === 'authenticated' && authUserId) {
      void (async () => {
        try {
          await configureChatDatabase(authUserId)
          if (cancelled) {
            return
          }
          await initChat()
          if (!isOffline()) {
            ensureApiKey()
          }
          await initSync(authUserId)
        } catch {
          showToast({ key: 'sessionListLoadFailed', type: 'error' })
        }
      })()
    } else {
      stopSyncScheduler()
      stopAllReplies()
      stopReadAloud()
      closeSettings()
    }
    return () => {
      cancelled = true
    }
  }, [authOffline, authStatus, authUserId])

  if (shareToken) {
    return (
      <>
        <SharedSessionPage token={shareToken} />
        <Toast />
        <PwaUpdateBanner />
      </>
    )
  }

  if (authStatus !== 'authenticated') {
    return (
      <>
        <LoginView />
        <Toast />
        <PwaUpdateBanner />
      </>
    )
  }

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {offline ? (
            <div className={styles.offlineNotice} role="status">
              {t('offlineModeNotice')}
            </div>
          ) : null}
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {!ready
                      ? initError
                        ? t('sessionListLoadFailed')
                        : t('sessionLoading')
                      : sessionLoadError
                        ? t(offline ? 'offlineSessionBodyMissing' : 'sessionLoadFailed')
                        : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <McpApprovalDialog />
      <Toast />
      <PwaUpdateBanner />
    </>
  )
}
