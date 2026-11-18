import { create } from 'zustand'
import type { ModelRef, ProviderModel, ProviderSummary, ProviderTemplate } from '@sweet-deepseek/contracts/providers'
import { listProviders } from './api/client.js'
import { setDefaultModel, useSettings } from './settings.js'
import { isOffline, useAuth } from './auth/store.js'
import { showToast } from '../components/base/toastState.js'
import { openSettings } from '../components/settings/settingsDialogState.js'

type ProviderState = {
  providers: ProviderSummary[]
  templates: ProviderTemplate[]
  loaded: boolean
  loading: boolean
  error: string | null
}

export const useProviders = create<ProviderState>(() => ({
  providers: [],
  templates: [],
  loaded: false,
  loading: false,
  error: null,
}))

export const resetProviders = () =>
  useProviders.setState({
    providers: [],
    templates: [],
    loaded: false,
    loading: false,
    error: null,
  })

export const refreshProviders = async (): Promise<void> => {
  if (isOffline()) {
    return
  }
  const state = useProviders.getState()
  if (state.loading) {
    return
  }
  useProviders.setState({ loading: true, error: null })
  try {
    const result = await listProviders()
    useProviders.setState({
      providers: result.providers,
      templates: result.templates,
      loaded: true,
      loading: false,
    })
    const current = useSettings.getState().defaultModel
    if (!current || !findModel(result.providers, current)) {
      const fallback =
        result.providers.find((provider) => provider.configured && provider.id === 'deepseek') ??
        result.providers.find((provider) => provider.configured)
      const firstModel = fallback?.models[0]
      if (fallback && firstModel) {
        setDefaultModel({ providerId: fallback.id, modelId: firstModel.id })
      }
    }
  } catch (error) {
    useProviders.setState({
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const findProvider = (providerId: string): ProviderSummary | undefined =>
  useProviders.getState().providers.find((provider) => provider.id === providerId)

export const findModel = (
  providers: ProviderSummary[],
  model: ModelRef
): ProviderModel | undefined =>
  providers.find((provider) => provider.id === model.providerId)?.models.find(
    (candidate) => candidate.id === model.modelId
  )

export const selectedModel = (): ModelRef => {
  const current = useSettings.getState().defaultModel
  if (current) {
    return current
  }
  return { providerId: 'deepseek', modelId: 'deepseek-flash' }
}

export const selectedProvider = (): ProviderSummary | undefined =>
  findProvider(selectedModel().providerId)

export const providerLabel = (provider: ProviderSummary, model: ProviderModel): string =>
  `${provider.name} · ${model.name}`

export const ensureSelectedModelConfigured = (): boolean => {
  if (isOffline()) {
    showToast({ key: 'offlineActionUnavailable' })
    return false
  }
  const provider = selectedProvider()
  if (provider?.configured) {
    return true
  }
  openSettings('models')
  return false
}

export const canUseDeepSeekFeatures = (): boolean => selectedModel().providerId === 'deepseek'

export const hasConfiguredDeepSeekProvider = (
  providers = useProviders.getState().providers
): boolean =>
  providers.some((provider) => provider.id === 'deepseek' && provider.configured) ||
  Boolean(useAuth.getState().user?.hasApiKey)

export const findProviderTemplate = (id: string): ProviderTemplate | undefined =>
  useProviders.getState().templates.find((template) => template.id === id)
