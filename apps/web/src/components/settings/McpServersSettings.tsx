import type { McpServerSummary } from '@sweet-deepseek/contracts/mcp'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  probeMcpServer,
  updateMcpServer,
} from '../../services/api/client.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

type Draft = {
  id: string | null
  name: string
  slug: string
  url: string
  headers: string
  enabled: boolean
}

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  slug: '',
  url: '',
  headers: '',
  enabled: true,
})

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32)

const parseHeaders = (value: string): Record<string, string> => {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const separator = trimmed.indexOf(':')
    if (separator <= 0) {
      throw new Error('invalid_header')
    }
    headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }
  return headers
}

export const McpServersSettings = () => {
  const t = useTranslate()
  const [servers, setServers] = useState<McpServerSummary[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    try {
      setServers(await listMcpServers())
    } catch {
      showToast({ key: 'mcpServersLoadFailed', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    if (saving) {
      return
    }
    let headers: Record<string, string>
    try {
      headers = parseHeaders(draft.headers)
    } catch {
      showToast({ key: 'mcpServerHeadersInvalid', type: 'error' })
      return
    }
    setSaving(true)
    try {
      if (draft.id) {
        await updateMcpServer(draft.id, {
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          url: draft.url.trim(),
          enabled: draft.enabled,
          ...(draft.headers.trim() ? { headers } : {}),
        })
      } else {
        await createMcpServer({
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          url: draft.url.trim(),
          headers,
          enabled: draft.enabled,
        })
      }
      setDraft(emptyDraft())
      await load()
      showToast({ key: 'mcpServerSaved' })
    } catch (error) {
      showToast({
        key: 'mcpServerSaveFailed',
        type: 'error',
        params: { message: error instanceof Error ? error.message : String(error) },
      })
    } finally {
      setSaving(false)
    }
  }

  const test = async (server: McpServerSummary) => {
    if (testingId) {
      return
    }
    setTestingId(server.id)
    setStatus((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== server.id))
    )
    try {
      const result = await probeMcpServer(server.id)
      setStatus((current) => ({
        ...current,
        [server.id]: result.ok
          ? t('mcpServerConnected', { count: result.tools.length })
          : t('mcpServerConnectFailed', { message: result.message }),
      }))
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [server.id]: t('mcpServerConnectFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      }))
    } finally {
      setTestingId(null)
    }
  }

  const remove = async (server: McpServerSummary) => {
    try {
      await deleteMcpServer(server.id)
      setConfirmingDeleteId(null)
      if (draft.id === server.id) {
        setDraft(emptyDraft())
      }
      await load()
    } catch {
      showToast({ key: 'mcpServerDeleteFailed', type: 'error' })
    }
  }

  return (
    <div className={styles.mcpSettings}>
      <div className={styles.sectionHeading}>{t('mcpServersTitle')}</div>
      <p className={styles.sectionDescription}>{t('mcpServersDescription')}</p>

      <div className={styles.mcpList}>
        {loading ? <div className={styles.mcpEmpty}>{t('mcpServersLoading')}</div> : null}
        {!loading && servers.length === 0 ? (
          <div className={styles.mcpEmpty}>{t('mcpServersEmpty')}</div>
        ) : null}
        {servers.map((server) => (
          <div className={styles.mcpServer} key={server.id}>
            <div className={styles.mcpServerMain}>
              <div className={styles.mcpServerTitleRow}>
                <strong>{server.name}</strong>
                <span className={styles.mcpSlug}>{server.slug}</span>
                <span className={server.enabled ? styles.mcpEnabled : styles.mcpDisabled}>
                  {t(server.enabled ? 'mcpServerEnabled' : 'mcpServerDisabled')}
                </span>
              </div>
              <div className={styles.mcpServerUrl}>{server.url}</div>
              {server.headerNames.length > 0 ? (
                <div className={styles.mcpHeaderNames}>
                  {t('mcpServerHeaderNames', { names: server.headerNames.join(', ') })}
                </div>
              ) : null}
              {status[server.id] ? (
                <div className={styles.mcpServerStatus}>{status[server.id]}</div>
              ) : null}
            </div>
            <div className={styles.mcpServerActions}>
              <Button
                size="s"
                variant="outlined"
                disabled={testingId !== null}
                onClick={() => void test(server)}
              >
                {t(testingId === server.id ? 'mcpServerTesting' : 'mcpServerTest')}
              </Button>
              <Button
                size="s"
                variant="outlined"
                onClick={() =>
                  setDraft({
                    id: server.id,
                    name: server.name,
                    slug: server.slug,
                    url: server.url,
                    headers: '',
                    enabled: server.enabled,
                  })
                }
              >
                {t('edit')}
              </Button>
              {confirmingDeleteId === server.id ? (
                <>
                  <Button size="s" variant="danger" onClick={() => void remove(server)}>
                    {t('delete')}
                  </Button>
                  <Button size="s" variant="outlined" onClick={() => setConfirmingDeleteId(null)}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  size="s"
                  variant="dangerOutlined"
                  onClick={() => setConfirmingDeleteId(server.id)}
                >
                  {t('delete')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        className={styles.mcpForm}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className={styles.sectionHeading}>
          {t(draft.id ? 'mcpServerEditTitle' : 'mcpServerAddTitle')}
        </div>
        <label className={styles.mcpField}>
          <span>{t('mcpServerName')}</span>
          <input
            value={draft.name}
            onChange={(event) => {
              const name = event.target.value
              setDraft((current) => ({
                ...current,
                name,
                ...(!current.id && (!current.slug || current.slug === toSlug(current.name))
                  ? { slug: toSlug(name) }
                  : {}),
              }))
            }}
            required
            maxLength={80}
          />
        </label>
        <label className={styles.mcpField}>
          <span>{t('mcpServerSlug')}</span>
          <input
            value={draft.slug}
            onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
            required
            maxLength={32}
            pattern="[a-z0-9][a-z0-9_-]{0,31}"
          />
          <small>{t('mcpServerSlugDescription')}</small>
        </label>
        <label className={styles.mcpField}>
          <span>{t('mcpServerUrl')}</span>
          <input
            type="url"
            value={draft.url}
            onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
            placeholder="https://example.com/mcp"
            required
          />
        </label>
        <label className={styles.mcpField}>
          <span>{t('mcpServerHeaders')}</span>
          <textarea
            value={draft.headers}
            onChange={(event) =>
              setDraft((current) => ({ ...current, headers: event.target.value }))
            }
            placeholder={'Authorization: Bearer ...\nX-Api-Key: ...'}
            rows={3}
          />
          <small>{t(draft.id ? 'mcpServerHeadersKeepHint' : 'mcpServerHeadersDescription')}</small>
        </label>
        <label className={styles.mcpCheckbox}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, enabled: event.target.checked }))
            }
          />
          <span>{t('mcpServerEnable')}</span>
        </label>
        <div className={styles.mcpFormActions}>
          {draft.id ? (
            <Button
              size="m"
              variant="outlined"
              onClick={() => setDraft(emptyDraft())}
              disabled={saving}
            >
              {t('cancel')}
            </Button>
          ) : null}
          <Button type="submit" size="m" disabled={saving}>
            {t(saving ? 'mcpServerSaving' : 'save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
