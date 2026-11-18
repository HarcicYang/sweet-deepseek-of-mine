import { useEffect, useState } from 'react'
import type {
  ProviderCreateRequest,
  ProviderModelInput,
  ProviderSummary,
  ProviderTemplate,
} from '@sweet-deepseek/contracts/providers'
import { createProvider, deleteProvider } from '../../services/api/client.js'
import {
  refreshProviders,
  useProviders,
} from '../../services/providers.js'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from './settingsDialogState.js'
import styles from './ProvidersSettings.module.css'

const DEFAULT_CUSTOM_MODELS = JSON.stringify(
  [
    {
      id: 'model-id',
      contextWindow: 131072,
      maxTokens: 32768,
      input: ['text'],
      reasoning: false,
      thinkingLevels: [],
    },
  ],
  null,
  2
)

const parseModels = (value: string): ProviderModelInput[] | null => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed as ProviderModelInput[]
  } catch {
    return null
  }
}

export const ProvidersSettings = () => {
  const t = useTranslate()
  const providers = useProviders((state) => state.providers)
  const templates = useProviders((state) => state.templates)
  const loading = useProviders((state) => state.loading)
  const defaultModel = useSettings((state) => state.defaultModel)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProviderSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!useProviders.getState().loaded) {
      void refreshProviders()
    }
  }, [])

  const configured = providers.filter((provider) => provider.configured)
  const selected = defaultModel
    ? configured.find((provider) => provider.id === defaultModel.providerId)
    : undefined

  const deleteSelected = async () => {
    if (!deleteTarget || deleting) {
      return
    }
    setDeleting(true)
    try {
      await deleteProvider(deleteTarget.id)
      await refreshProviders()
      setDeleteTarget(null)
      showToast({ key: 'providerDeleted' })
    } catch {
      showToast({ key: 'providerDeleteFailed', type: 'error' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>{t('providersTitle')}</div>
          <div className={styles.description}>{t('providersDescription')}</div>
        </div>
        <Button variant="outlined" size="m" onClick={() => setAddOpen(true)}>
          {t('providerAdd')}
        </Button>
      </div>

      <div className={styles.list}>
        {providers.map((provider) => (
          <div key={provider.id} className={styles.provider}>
            <div className={styles.providerMain}>
              <div className={styles.providerName}>
                {provider.name}
                {selected?.id === provider.id ? (
                  <span className={styles.current}>{t('providerCurrent')}</span>
                ) : null}
              </div>
              <div className={styles.meta}>
                {provider.api ?? provider.kind} · {provider.models.length} {t('providerModels')}
              </div>
              {provider.baseUrl ? <div className={styles.url}>{provider.baseUrl}</div> : null}
            </div>
            <div className={styles.actions}>
              {!provider.configured ? (
                <Button
                  variant="outlined"
                  size="s"
                  onClick={() => {
                    if (provider.id === 'deepseek') {
                      openSettings('data')
                    }
                  }}
                >
                  {t('providerConfigure')}
                </Button>
              ) : null}
              {provider.kind !== 'deepseek' ? (
                <Button
                  variant="dangerOutlined"
                  size="s"
                  onClick={() => setDeleteTarget(provider)}
                >
                  {t('delete')}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {loading ? <div className={styles.loading}>{t('providerLoading')}</div> : null}
      {addOpen ? (
        <AddProviderDialog
          templates={templates}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
          }}
        />
      ) : null}
      {deleteTarget ? (
        <Modal
          title={t('providerDeleteTitle')}
          onClose={() => !deleting && setDeleteTarget(null)}
          footer={
            <>
              <Button variant="outlined" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={deleting} onClick={() => void deleteSelected()}>
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('providerDeleteDescription', { name: deleteTarget.name })}
        </Modal>
      ) : null}
    </div>
  )
}

const AddProviderDialog = ({
  templates,
  onClose,
  onCreated,
}: {
  templates: ProviderTemplate[]
  onClose: () => void
  onCreated: () => void
}) => {
  const t = useTranslate()
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [models, setModels] = useState(DEFAULT_CUSTOM_MODELS)
  const [busy, setBusy] = useState(false)
  const template = templates.find((candidate) => candidate.id === templateId)
  const custom = template?.kind === 'custom'
  const supportsApiKey = template?.authModes.includes('api_key') ?? false

  useEffect(() => {
    if (!templateId && templates[0]) {
      setTemplateId(templates[0].id)
    }
  }, [templateId, templates])

  const save = async () => {
    if (!template || !supportsApiKey || !apiKey.trim() || busy) {
      return
    }
    let parsedModels: ProviderModelInput[] | undefined
    if (custom) {
      parsedModels = parseModels(models) ?? undefined
      if (!parsedModels?.length || !baseUrl.trim()) {
        showToast({ key: 'providerInvalidCustom', type: 'error' })
        return
      }
    }
    const input: ProviderCreateRequest = {
      templateId: template.id,
      apiKey: apiKey.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(parsedModels ? { models: parsedModels } : {}),
    }
    setBusy(true)
    try {
      await createProvider(input)
      await refreshProviders()
      showToast({ key: 'providerAdded' })
      onCreated()
    } catch {
      showToast({ key: 'providerAddFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('providerAddTitle')}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !template || !supportsApiKey}
            onClick={() => void save()}
          >
            {busy ? t('providerSaving') : t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label>
          <span>{t('providerTemplate')}</span>
          <Select
            value={templateId}
            options={templates.map((item) => ({
              value: item.id,
              label:
                item.kind === 'custom'
                  ? `${item.name} · ${item.api ?? ''}`
                  : `${item.name}${item.authModes.includes('api_key') ? '' : ' · OAuth'}`,
            }))}
            onChange={setTemplateId}
            variant="field"
            block
          />
        </label>
        <label>
          <span>{t('providerName')}</span>
          <input
            value={name}
            placeholder={template?.name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>{t('providerApiKey')}</span>
          <input
            type="password"
            value={apiKey}
            disabled={!supportsApiKey}
            autoComplete="new-password"
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {!supportsApiKey ? <div className={styles.warning}>{t('providerOauthOnly')}</div> : null}
        <label>
          <span>{t('providerBaseUrl')}</span>
          <input
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        {custom ? (
          <label>
            <span>{t('providerCustomModels')}</span>
            <textarea
              className={styles.models}
              value={models}
              onChange={(event) => setModels(event.target.value)}
            />
          </label>
        ) : null}
      </div>
    </Modal>
  )
}
