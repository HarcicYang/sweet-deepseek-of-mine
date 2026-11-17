import { AuthUserSchema, type AuthUser } from '@sweet-deepseek/contracts/api'
import { create } from 'zustand'
import { ApiError, beginGithubLogin, getSession, logout } from '../api/client.js'
import { clearLocalSettings } from '../settings.js'
import { useSync } from '../sync/engine.js'

export type AuthNotice = 'oauth_error' | 'session_expired' | 'network_error' | null
const REMEMBERED_USER_KEY = 'chat-demo:remembered-user'

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error'
  user: AuthUser | null
  notice: AuthNotice
  offline: boolean
}

export const useAuth = create<AuthState>(() => ({
  status: 'loading',
  user: null,
  notice: null,
  offline: false,
}))

let initTask: Promise<void> | undefined

const readRememberedUser = (): AuthUser | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REMEMBERED_USER_KEY) ?? 'null')
    const parsed = AuthUserSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const rememberUser = (user: AuthUser) => {
  try {
    localStorage.setItem(REMEMBERED_USER_KEY, JSON.stringify(user))
  } catch {
    // Storage is optional; online authentication still works without it.
  }
}

const forgetRememberedUser = () => {
  try {
    localStorage.removeItem(REMEMBERED_USER_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

const readOAuthResult = (): 'success' | 'error' | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const result = new URL(window.location.href).searchParams.get('auth')
  return result === 'success' || result === 'error' ? result : null
}

const clearOAuthResult = () => {
  if (typeof window === 'undefined') {
    return
  }
  const url = new URL(window.location.href)
  if (!url.searchParams.has('auth')) {
    return
  }
  url.searchParams.delete('auth')
  url.searchParams.delete('reason')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export const initAuth = (): Promise<void> => {
  if (initTask) {
    return initTask
  }
  const previous = useAuth.getState()
  const silent = previous.status === 'authenticated' && previous.offline
  const rememberedUser = readRememberedUser()
  const oauthResult = readOAuthResult()
  if (!silent) {
    useAuth.setState({ status: 'loading', notice: null })
  }
  initTask = (async () => {
    try {
      const session = await getSession()
      rememberUser(session.user)
      useAuth.setState({
        status: 'authenticated',
        user: session.user,
        notice: null,
        offline: false,
      })
    } catch (error) {
      const unauthorized = error instanceof ApiError && error.status === 401
      const networkError = error instanceof ApiError && error.kind === 'network'
      if (unauthorized) {
        forgetRememberedUser()
        useAuth.setState({
          status: 'anonymous',
          user: null,
          notice: null,
          offline: false,
        })
      } else if (networkError && rememberedUser) {
        useAuth.setState({
          status: 'authenticated',
          user: rememberedUser,
          notice: null,
          offline: true,
        })
      } else {
        useAuth.setState({
          status: 'error',
          user: null,
          notice:
            oauthResult === 'error'
              ? 'oauth_error'
              : networkError
                ? 'network_error'
                : 'oauth_error',
          offline: networkError,
        })
      }
    } finally {
      clearOAuthResult()
      initTask = undefined
    }
  })()
  return initTask
}

export const loginWithGithub = () => {
  beginGithubLogin()
}

export const signOut = async () => {
  await logout()
  forgetRememberedUser()
  clearLocalSettings()
  useAuth.setState({ status: 'anonymous', user: null, notice: null, offline: false })
}

export const setApiKeyConfigured = (configured: boolean) => {
  useAuth.setState((state) => {
    if (!state.user) {
      return state
    }
    const user = { ...state.user, hasApiKey: configured }
    rememberUser(user)
    return { user }
  })
}

export const isOffline = () =>
  useAuth.getState().offline ||
  useSync.getState().status === 'offline' ||
  (typeof navigator !== 'undefined' && navigator.onLine === false)

if (typeof window !== 'undefined') {
  const revalidate = () => {
    const state = useAuth.getState()
    if (state.status === 'authenticated' && state.offline) {
      void initAuth()
    }
  }
  window.addEventListener('online', revalidate)
  window.addEventListener('focus', revalidate)
  window.addEventListener('offline', () => {
    if (useAuth.getState().status === 'authenticated') {
      useAuth.setState({ offline: true })
    }
  })
  window.addEventListener('sdom:auth-expired', () => {
    forgetRememberedUser()
    clearLocalSettings()
    useAuth.setState({
      status: 'anonymous',
      user: null,
      notice: 'session_expired',
      offline: false,
    })
  })
}
