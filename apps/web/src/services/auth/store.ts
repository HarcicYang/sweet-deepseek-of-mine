import type { AuthUser } from '@sweet-deepseek/contracts/api'
import { create } from 'zustand'
import { ApiError, beginGithubLogin, getSession, logout } from '../api/client.js'

export type AuthNotice = 'oauth_error' | 'session_expired' | 'network_error' | null

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error'
  user: AuthUser | null
  notice: AuthNotice
}

export const useAuth = create<AuthState>(() => ({
  status: 'loading',
  user: null,
  notice: null,
}))

let initTask: Promise<void> | undefined

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
  const oauthResult = readOAuthResult()
  useAuth.setState({ status: 'loading', notice: null })
  initTask = (async () => {
    try {
      const session = await getSession()
      useAuth.setState({ status: 'authenticated', user: session.user, notice: null })
    } catch (error) {
      const unauthorized = error instanceof ApiError && error.status === 401
      useAuth.setState({
        status: unauthorized ? 'anonymous' : 'error',
        user: null,
        notice:
          oauthResult === 'error'
            ? 'oauth_error'
            : unauthorized
              ? null
              : error instanceof ApiError && error.kind === 'network'
                ? 'network_error'
                : 'oauth_error',
      })
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
  useAuth.setState({ status: 'anonymous', user: null, notice: null })
}

export const setApiKeyConfigured = (configured: boolean) => {
  useAuth.setState((state) =>
    state.user
      ? {
          user: { ...state.user, hasApiKey: configured },
        }
      : state
  )
}

if (typeof window !== 'undefined') {
  window.addEventListener('sdom:auth-expired', () => {
    useAuth.setState({
      status: 'anonymous',
      user: null,
      notice: 'session_expired',
    })
  })
}
