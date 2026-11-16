import type { McpAuthMode, McpServerSummary } from '@sweet-deepseek/contracts/mcp'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  createMcpServer,
  deleteMcpServer,
  disconnectMcpOAuth,
  listMcpServers,
  probeMcpServer,
  startMcpOAuth,
  updateMcpServer,
} from '../../services/api/client.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { McpDiscovery, type McpRegistryImport } from './McpDiscovery.js'
import styles from './Settings.module.css'

type Draft = {
  id: string | null
  name: string
  slug: string
  url: string
  authMode: McpAuthMode
  headers: string
  enabled: boolean
}

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  slug: '',
  url: '',
  authMode: 'static',
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

const normalizeUrl = (value: string): string => {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

export const McpServersSettings = () => {
  const t = useTranslate()
  const [section, setSection] = useState<'installed' | 'discover'>('installed')
  const [servers, setServers] = useState<McpServerSummary[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [oauthBusyId, setOauthBusyId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, string>>({})

  const uniqueSlug = (value: string): string => {
    const base = toSlug(value) || 'mcp'
    if (!servers.some((server) => server.slug === base)) {
      return base
    }
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const marker = `-${suffix}`
      const candidate = `${base.slice(0, 32 - marker.length)}${marker}`
      if (!servers.some((server) => server.slug === candidate)) {
        return candidate
      }
    }
    return crypto.randomUUID().slice(0, 8)
  }

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

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) {
        return
      }
      const data = event.data
      if (data === null || typeof data !== 'object') {
        return
      }
      const message = data as Record<string, unknown>
      if (
        message.type !== 'sdom:mcp-oauth' ||
        typeof message.serverId !== 'string' ||
        typeof message.ok !== 'boolean'
      ) {
        return
      }
      const { serverId, ok } = message
      setOauthBusyId(null)
      if (!ok) {
        setStatus((current) => ({
          ...current,
          [serverId]: t('mcpOAuthFailed'),
        }))
        return
      }
      setStatus((current) => ({
        ...current,
        [serverId]: t('mcpOAuthConnected'),
      }))
      void listMcpServers()
        .then(setServers)
        .catch(() => undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [t])

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
    const currentServer = draft.id ? servers.find((server) => server.id === draft.id) : null
    const shouldAuthorize =
      draft.authMode === 'oauth' &&
      (!currentServer || currentServer.authMode !== 'oauth' || !currentServer.oauthConnected)
    const oauthPopup = shouldAuthorize
      ? window.open('about:blank', 'sdom-mcp-oauth', 'popup,width=560,height=720')
      : null
    try {
      let savedServer: McpServerSummary
      if (draft.id) {
        savedServer = await updateMcpServer(draft.id, {
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          url: draft.url.trim(),
          authMode: draft.authMode,
          enabled: draft.enabled,
          ...(draft.headers.trim() ? { headers } : {}),
        })
      } else {
        savedServer = await createMcpServer({
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          url: draft.url.trim(),
          authMode: draft.authMode,
          headers,
          enabled: draft.enabled,
        })
      }
      setDraft(emptyDraft())
      await load()
      showToast({ key: 'mcpServerSaved' })
      if (shouldAuthorize) {
        if (oauthPopup) {
          void authorizeInPopup(savedServer, oauthPopup)
        } else {
          showToast({ key: 'mcpOAuthPopupBlocked', type: 'error' })
        }
      }
    } catch (error) {
      oauthPopup?.close()
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

  const authorizeInPopup = async (server: McpServerSummary, popup: Window) => {
    if (oauthBusyId) {
      popup.close()
      return
    }
    setOauthBusyId(server.id)
    window.setTimeout(
      () => {
        setOauthBusyId((current) => (current === server.id ? null : current))
      },
      5 * 60 * 1000
    )
    setStatus((current) => ({
      ...current,
      [server.id]: t('mcpOAuthWaiting'),
    }))
    try {
      const result = await startMcpOAuth(server.id)
      popup.location.href = result.authorizationUrl
    } catch (error) {
      popup.close()
      setOauthBusyId(null)
      setStatus((current) => ({
        ...current,
        [server.id]: t('mcpOAuthStartFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      }))
    }
  }

  const authorize = (server: McpServerSummary) => {
    if (oauthBusyId) {
      return
    }
    const popup = window.open('about:blank', 'sdom-mcp-oauth', 'popup,width=560,height=720')
    if (!popup) {
      showToast({ key: 'mcpOAuthPopupBlocked', type: 'error' })
      return
    }
    void authorizeInPopup(server, popup)
  }

  const disconnectOAuth = async (server: McpServerSummary) => {
    try {
      await disconnectMcpOAuth(server.id)
      await load()
      setStatus((current) => ({
        ...current,
        [server.id]: t('mcpOAuthDisconnected'),
      }))
    } catch {
      showToast({ key: 'mcpOAuthDisconnectFailed', type: 'error' })
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

  const importRegistryServer = (item: McpRegistryImport) => {
    const url = normalizeUrl(item.url)
    if (servers.some((server) => normalizeUrl(server.url) === url)) {
      showToast({ key: 'mcpRegistryDuplicateBlocked', type: 'error' })
      return
    }
    setDraft({
      ...emptyDraft(),
      name: item.name.slice(0, 80),
      slug: uniqueSlug(item.suggestedSlug),
      url: item.url,
      authMode: 'static',
    })
    setSection('installed')
    showToast({ key: 'mcpRegistryImported' })
    requestAnimationFrame(() => {
      document
        .getElementById('mcp-server-form')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const editingServer = draft.id ? servers.find((server) => server.id === draft.id) : null
  const willAuthorize =
    draft.authMode === 'oauth' &&
    (!editingServer || editingServer.authMode !== 'oauth' || !editingServer.oauthConnected)

  return (
    <div className={styles.mcpSettings}>
      <div className={styles.sectionHeading}>{t('mcpServersTitle')}</div>
      <p className={styles.sectionDescription}>{t('mcpServersDescription')}</p>

      <div className={styles.mcpSectionTabs}>
        <button
          type="button"
          className={section === 'installed' ? styles.mcpSectionTabActive : styles.mcpSectionTab}
          aria-pressed={section === 'installed'}
          onClick={() => setSection('installed')}
        >
          {t('mcpSectionInstalled')}
        </button>
        <button
          type="button"
          className={section === 'discover' ? styles.mcpSectionTabActive : styles.mcpSectionTab}
          aria-pressed={section === 'discover'}
          onClick={() => setSection('discover')}
        >
          {t('mcpSectionDiscover')}
        </button>
      </div>

      {section === 'discover' ? (
        <McpDiscovery installedServers={servers} onImport={importRegistryServer} />
      ) : (
        <>
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
                    {server.authMode === 'oauth' ? (
                      <span
                        className={
                          server.oauthConnected ? styles.mcpOAuthConnected : styles.mcpOAuthPending
                        }
                      >
                        {t(
                          server.oauthConnected ? 'mcpOAuthConnectedBadge' : 'mcpOAuthNotConnected'
                        )}
                      </span>
                    ) : null}
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
                  {server.authMode === 'oauth' ? (
                    <>
                      <Button
                        size="s"
                        variant="outlined"
                        disabled={oauthBusyId !== null}
                        onClick={() => void authorize(server)}
                      >
                        {t(
                          oauthBusyId === server.id
                            ? 'mcpOAuthAuthorizing'
                            : server.oauthConnected
                              ? 'mcpOAuthReauthorize'
                              : 'mcpOAuthAuthorize'
                        )}
                      </Button>
                      {server.oauthConnected ? (
                        <Button
                          size="s"
                          variant="outlined"
                          onClick={() => void disconnectOAuth(server)}
                        >
                          {t('mcpOAuthDisconnect')}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Button
                    size="s"
                    variant="outlined"
                    onClick={() =>
                      setDraft({
                        id: server.id,
                        name: server.name,
                        slug: server.slug,
                        url: server.url,
                        authMode: server.authMode,
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
                      <Button
                        size="s"
                        variant="outlined"
                        onClick={() => setConfirmingDeleteId(null)}
                      >
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
            id="mcp-server-form"
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
                onChange={(event) =>
                  setDraft((current) => ({ ...current, slug: event.target.value }))
                }
                required
                maxLength={32}
                pattern="[a-z0-9][a-z0-9_-]{0,31}"
              />
              <small>{t('mcpServerSlugDescription')}</small>
            </label>
            <div className={styles.mcpField}>
              <span>{t('mcpAuthMode')}</span>
              <Select
                value={draft.authMode}
                options={[
                  { value: 'static', label: t('mcpAuthModeStatic') },
                  { value: 'oauth', label: t('mcpAuthModeOAuth') },
                ]}
                onChange={(authMode) => setDraft((current) => ({ ...current, authMode }))}
                variant="field"
                block
                ariaLabel={t('mcpAuthMode')}
              />
            </div>
            {draft.authMode === 'oauth' ? (
              <p className={styles.sectionDescription}>{t('mcpOAuthDeploymentManaged')}</p>
            ) : null}
            <label className={styles.mcpField}>
              <span>{t('mcpServerUrl')}</span>
              <input
                type="url"
                value={draft.url}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, url: event.target.value }))
                }
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
              <small>
                {t(draft.id ? 'mcpServerHeadersKeepHint' : 'mcpServerHeadersDescription')}
              </small>
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
                {t(
                  saving
                    ? draft.authMode === 'oauth'
                      ? 'mcpServerSavingAndAuthorizing'
                      : 'mcpServerSaving'
                    : willAuthorize
                      ? 'mcpServerSaveAndAuthorize'
                      : 'save'
                )}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}
