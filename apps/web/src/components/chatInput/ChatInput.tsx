import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThinkingMode } from '@sweet-deepseek/contracts'
import {
  IconGlobeLanguageOutline14,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
} from '../base/icons.js'
import {
  setDefaultModel,
  setSearch,
  setThinkingMode,
  useSettings,
} from '../../services/settings.js'
import { useAuth } from '../../services/auth/store.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import { useSync } from '../../services/sync/engine.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import {
  canUseDeepSeekFeatures,
  ensureSelectedModelConfigured,
  useProviders,
} from '../../services/providers.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { ModelThinkingMenu } from './ModelThinkingMenu.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 思考模式与智能搜索 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinkingMode = useSettings((state) => state.thinkingMode)
  const defaultModel = useSettings((state) => state.defaultModel)
  const providers = useProviders((state) => state.providers)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const currentProvider = defaultModel
    ? providers.find((provider) => provider.id === defaultModel.providerId)
    : undefined
  const currentModel = currentProvider?.models.find(
    (model) => model.id === defaultModel?.modelId
  )
  const deepSeek = canUseDeepSeekFeatures()
  const hasDeepSeekKey = useAuth((state) => state.user?.hasApiKey ?? false)
  const deepSeekToolsAvailable = hasDeepSeekKey
  const modelOptions = providers.flatMap((provider) =>
    provider.configured
      ? provider.models.map((model) => ({
          value: `${provider.id}\u0000${model.id}`,
          label: `${provider.name} · ${model.name}`,
        }))
      : []
  )
  const currentModelValue = currentProvider && currentModel
    ? `${currentProvider.id}\u0000${currentModel.id}`
    : ''
  const thinkingOptions = useMemo<ThinkingMode[]>(() => {
    if (!currentModel) {
      return deepSeek ? ['disabled', 'low', 'high', 'max'] : ['disabled']
    }
    if (currentModel.thinkingLevels.length === 0) {
      return ['disabled']
    }
    return currentModel.thinkingLevels
      .map((level) => (level === 'off' ? 'disabled' : level))
      .filter(
        (level): level is ThinkingMode =>
          level === 'disabled' || level === 'low' || level === 'high' || level === 'max'
      )
  }, [currentModel, deepSeek])
  const offline =
    useAuth((state) => state.offline) || useSync((state) => state.status === 'offline')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!deepSeekToolsAvailable && search) {
      setSearch(false)
    }
  }, [deepSeekToolsAvailable, search])

  useEffect(() => {
    if (!thinkingOptions.includes(thinkingMode)) {
      setThinkingMode(thinkingOptions[0] ?? 'disabled')
    }
  }, [thinkingMode, thinkingOptions])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (
      files.length === 0 ||
      !deepSeek ||
      useChatStore.getState().importingHistory ||
      !ensureApiKey()
    ) {
      return
    }
    const error = addDraftFiles(sessionId, files)
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend =
    !offline && !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureSelectedModelConfigured() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 思考模式 / 智能搜索，tooltip 在控件上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('thinkingModeTooltip')}>
            <ModelThinkingMenu
              currentModelValue={currentModelValue}
              modelOptions={modelOptions}
              thinkingMode={thinkingMode}
              thinkingOptions={thinkingOptions}
              onModelChange={(value) => {
                const [providerId, modelId] = value.split('\u0000')
                if (providerId && modelId) {
                  setDefaultModel({ providerId, modelId })
                }
              }}
              onThinkingChange={setThinkingMode}
            />
          </Tooltip>
          <Tooltip
            content={
              deepSeekToolsAvailable
                ? t('deactivatedSearchTooltip')
                : t('providerFeatureUnavailable')
            }
          >
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              disabled={!deepSeekToolsAvailable}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          <VoiceButton
            status={voice.status}
            disabled={!voice.available || offline || !deepSeek}
            seconds={voice.seconds}
            onClick={() => {
              if (
                voice.status !== 'idle' ||
                (deepSeek && !useChatStore.getState().importingHistory && ensureApiKey())
              ) {
                void voice.toggle()
              }
            }}
          />
          <IconButton
            size="m"
            tone="primary"
            icon={<IconPaperclipOutline16 />}
            tooltip={t('uploadFile')}
            disabled={importingHistory || offline || !deepSeek}
            onClick={() => ensureApiKey() && fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
