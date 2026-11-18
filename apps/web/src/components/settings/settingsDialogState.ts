import { create } from 'zustand'
import { isOffline, useAuth } from '../../services/auth/store.js'
import { showToast } from '../base/toastState.js'

/** 设置弹窗的分组：通用设置 / 模型提供商 / 数据管理 / Skills / MCP 工具 */
export type SettingsSection = 'general' | 'models' | 'data' | 'skills' | 'mcp'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (isOffline()) {
    showToast({ key: 'offlineActionUnavailable' })
    return false
  }
  const auth = useAuth.getState()
  if (auth.status === 'authenticated' && auth.user?.hasApiKey) {
    return true
  }
  if (auth.status === 'authenticated') {
    openSettings('data')
  }
  return false
}
