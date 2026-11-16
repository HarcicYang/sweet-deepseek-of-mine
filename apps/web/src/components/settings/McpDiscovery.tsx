import type { McpRegistryServer, McpServerSummary } from '@sweet-deepseek/contracts/mcp'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { listMcpRegistryServers } from '../../services/api/client.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

export type McpRegistryImport = {
  name: string
  suggestedSlug: string
  url: string
}

type McpDiscoveryProps = {
  installedServers: McpServerSummary[]
  onImport: (item: McpRegistryImport) => void
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

const suggestedSlug = (server: McpRegistryServer): string =>
  (server.registryName.split('/').at(-1) ?? server.title)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32) || 'mcp'

const formatDate = (value: string | null): string | null => {
  if (!value) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null
}

export const McpDiscovery = ({ installedServers, onImport }: McpDiscoveryProps) => {
  const t = useTranslate()
  const [input, setInput] = useState('')
  const [loadedSearch, setLoadedSearch] = useState('')
  const [servers, setServers] = useState<McpRegistryServer[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedRemotes, setSelectedRemotes] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async ({
      search,
      cursor,
      replace,
    }: {
      search: string
      cursor?: string | null
      replace: boolean
    }) => {
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      setLoading(true)
      setError(null)
      try {
        const result = await listMcpRegistryServers({
          search,
          cursor,
          limit: 30,
          signal: controller.signal,
        })
        setServers((current) => (replace ? result.servers : [...current, ...result.servers]))
        setLoadedSearch(result.search)
        setNextCursor(result.nextCursor)
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }
        setError(
          t('mcpRegistryLoadFailed', {
            message: loadError instanceof Error ? loadError.message : String(loadError),
          })
        )
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    },
    [t]
  )

  useEffect(() => {
    void load({ search: '', replace: true })
    return () => requestRef.current?.abort()
  }, [load])

  const query = input.trim()
  const localFilter = query.length > 0 && query.length < 3
  const installedUrls = useMemo(
    () => new Set(installedServers.map((server) => normalizeUrl(server.url))),
    [installedServers]
  )
  const visibleServers = useMemo(() => {
    if (!localFilter) {
      return servers
    }
    const needle = query.toLowerCase()
    return servers.filter((server) =>
      [
        server.title,
        server.registryName,
        server.publisher,
        server.description,
        ...server.remotes.map((remote) => remote.url),
      ].some((value) => value.toLowerCase().includes(needle))
    )
  }, [localFilter, query, servers])

  const submitSearch = () => {
    if (localFilter) {
      return
    }
    void load({ search: query, replace: true })
  }

  return (
    <div className={styles.mcpDiscovery}>
      <p className={styles.sectionDescription}>{t('mcpRegistryDescription')}</p>
      <form
        className={styles.mcpRegistrySearch}
        onSubmit={(event) => {
          event.preventDefault()
          submitSearch()
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('mcpRegistrySearchPlaceholder')}
          maxLength={128}
          aria-label={t('mcpRegistrySearchPlaceholder')}
        />
        <Button type="submit" size="s" disabled={loading}>
          {t('mcpRegistrySearch')}
        </Button>
      </form>
      <p className={styles.mcpRegistryHint}>{t('mcpRegistrySearchHint')}</p>
      <p className={styles.mcpRegistryNotice}>{t('mcpRegistryOfficialNotice')}</p>

      {error ? <div className={styles.mcpRegistryError}>{error}</div> : null}
      {loading && servers.length === 0 ? (
        <div className={styles.mcpEmpty}>{t('mcpRegistryLoading')}</div>
      ) : null}
      {!loading && visibleServers.length === 0 && !error ? (
        <div className={styles.mcpEmpty}>{t('mcpRegistryEmpty')}</div>
      ) : null}

      <div className={styles.mcpRegistryList}>
        {visibleServers.map((server) => {
          const key = `${server.registryName}@${server.version}`
          const remoteIndex = Math.min(selectedRemotes[key] ?? 0, server.remotes.length - 1)
          const remote = server.remotes[remoteIndex]
          if (!remote) {
            return null
          }
          const installed = installedUrls.has(normalizeUrl(remote.url))
          const date = formatDate(server.updatedAt)
          return (
            <article className={styles.mcpRegistryCard} key={key}>
              <div className={styles.mcpRegistryCardHeader}>
                <div className={styles.mcpRegistryCardTitle}>
                  <strong>{server.title}</strong>
                  <span>{server.registryName}</span>
                </div>
                <span
                  className={`${styles.mcpRegistryBadge} ${
                    remote.requiresAuthentication
                      ? styles.mcpRegistryBadgeAuth
                      : styles.mcpRegistryBadgePublic
                  }`}
                >
                  {t(
                    remote.requiresAuthentication ? 'mcpRegistryRequiresAuth' : 'mcpRegistryPublic'
                  )}
                </span>
              </div>
              {server.description ? (
                <p className={styles.mcpRegistryDescription}>{server.description}</p>
              ) : null}
              <div className={styles.mcpRegistryMeta}>
                <span>{t('mcpRegistryVersion', { version: server.version })}</span>
                {date ? <span>{t('mcpRegistryUpdatedAt', { date })}</span> : null}
                {server.repositoryUrl ? (
                  <a href={server.repositoryUrl} target="_blank" rel="noreferrer">
                    {server.publisher}
                  </a>
                ) : (
                  <span>{server.publisher}</span>
                )}
              </div>
              {server.remotes.length > 1 ? (
                <label className={styles.mcpRegistryRemote}>
                  <span>{t('mcpRegistryRemoteChoices')}</span>
                  <select
                    value={remoteIndex}
                    onChange={(event) =>
                      setSelectedRemotes((current) => ({
                        ...current,
                        [key]: Number(event.target.value),
                      }))
                    }
                  >
                    {server.remotes.map((candidate, index) => (
                      <option value={index} key={candidate.url}>
                        {candidate.url}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className={styles.mcpRegistryUrl}>{remote.url}</div>
              )}
              {remote.requiredHeaderNames.length > 0 ? (
                <div className={styles.mcpRegistryHeaders}>
                  {t('mcpRegistryRequiredHeaders', {
                    names: remote.requiredHeaderNames.join(', '),
                  })}
                </div>
              ) : null}
              {remote.requiresAuthentication ? (
                <p className={styles.mcpRegistryAuthHint}>{t('mcpRegistryAuthHint')}</p>
              ) : null}
              <div className={styles.mcpRegistryActions}>
                <Button
                  size="s"
                  disabled={installed}
                  onClick={() =>
                    onImport({
                      name: server.title,
                      suggestedSlug: suggestedSlug(server),
                      url: remote.url,
                    })
                  }
                >
                  {t(installed ? 'mcpRegistryAlreadyAdded' : 'mcpRegistryImport')}
                </Button>
              </div>
            </article>
          )
        })}
      </div>

      {nextCursor ? (
        <div className={styles.mcpRegistryMore}>
          <Button
            size="s"
            variant="outlined"
            disabled={loading}
            onClick={() =>
              void load({
                search: loadedSearch,
                cursor: nextCursor,
                replace: false,
              })
            }
          >
            {t('mcpRegistryLoadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
