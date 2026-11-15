import {
  SYNC_SETTINGS_SCHEMA_VERSION,
  type SyncedSettingsPayload,
} from '@sweet-deepseek/contracts/sync'
import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  settingsUpdatedAt: 'chat-demo:settings-updated-at',
  settingsOwner: 'chat-demo:settings-owner',
} as const

export const SETTINGS_CHANGED_EVENT = 'sdom:settings-changed'

// 旧版本曾把 DeepSeek API Key 保存在浏览器；启动时主动清理遗留明文。
try {
  localStorage.removeItem('chat-demo:api-key')
} catch {
  // 存储不可用时无需处理
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const readSettingsUpdatedAt = (): number => {
  const value = Number(read(KEYS.settingsUpdatedAt))
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

const notifySettingsChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
  }
}

const markSyncedSettingsChanged = () => {
  write(KEYS.settingsUpdatedAt, String(Date.now()))
  notifySettingsChanged()
}

export const useSettings = create<Settings>(() => ({
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  if (JSON.stringify(location) === JSON.stringify(useSettings.getState().location)) {
    return
  }
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
  markSyncedSettingsChanged()
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  if (ttsVoice === useSettings.getState().ttsVoice) {
    return
  }
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
  markSyncedSettingsChanged()
}

export const setThinking = (thinking: boolean) => {
  if (thinking === useSettings.getState().thinking) {
    return
  }
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
  markSyncedSettingsChanged()
}

export const setSearch = (search: boolean) => {
  if (search === useSettings.getState().search) {
    return
  }
  write(KEYS.search, String(search))
  useSettings.setState({ search })
  markSyncedSettingsChanged()
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const getSyncedSettings = (): SyncedSettingsPayload => {
  const { thinking, search, ttsVoice, location } = useSettings.getState()
  return {
    schemaVersion: SYNC_SETTINGS_SCHEMA_VERSION,
    thinking,
    search,
    ttsVoice,
    location,
    updatedAt: readSettingsUpdatedAt(),
  }
}

/** 应用远端设置时不触发本机同步事件，避免把刚拉取的值再次推送。 */
export const applySyncedSettings = (payload: SyncedSettingsPayload): void => {
  const location = normalizeLocation(payload.location)
  write(KEYS.thinking, String(payload.thinking))
  write(KEYS.search, String(payload.search))
  write(KEYS.ttsVoice, payload.ttsVoice)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  write(KEYS.settingsUpdatedAt, String(payload.updatedAt))
  useSettings.setState({
    thinking: payload.thinking,
    search: payload.search,
    ttsVoice: payload.ttsVoice,
    location,
  })
}

export const prepareSyncedSettingsForUser = (userId: string): void => {
  const previousOwner = read(KEYS.settingsOwner)
  if (previousOwner === userId) {
    return
  }
  write(KEYS.settingsOwner, userId)
  if (previousOwner !== null) {
    applySyncedSettings({
      schemaVersion: SYNC_SETTINGS_SCHEMA_VERSION,
      thinking: false,
      search: false,
      ttsVoice: 'stella',
      location: null,
      updatedAt: 0,
    })
  }
}
