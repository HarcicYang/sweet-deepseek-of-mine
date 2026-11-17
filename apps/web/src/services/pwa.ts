import { create } from 'zustand'

type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt: () => Promise<void>
}

type PwaState = {
  installed: boolean
  installPrompt: BeforeInstallPromptEvent | null
  updateReady: boolean
}

export const usePwa = create<PwaState>(() => ({
  installed: false,
  installPrompt: null,
  updateReady: false,
}))

let registration: ServiceWorkerRegistration | null = null
let refreshing = false

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true)

const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/iu.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export const canShowInstallHelp = () => isIos() && !isStandalone()

const showUpdateReady = () => {
  if (navigator.serviceWorker.controller) {
    usePwa.setState({ updateReady: true })
  }
}

const watchRegistration = (next: ServiceWorkerRegistration) => {
  registration = next
  if (next.waiting) {
    showUpdateReady()
  }
  next.addEventListener('updatefound', () => {
    const worker = next.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        showUpdateReady()
      }
    })
  })
}

const registerServiceWorker = async () => {
  if (!__SDOM_PWA__ || !('serviceWorker' in navigator)) {
    return
  }
  try {
    const next = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), {
      scope: './',
      updateViaCache: 'none',
    })
    watchRegistration(next)
  } catch {
    // PWA support is optional; keep the online app usable if registration fails.
  }
}

const checkForUpdate = () => {
  if (registration && navigator.onLine) {
    void registration.update().catch(() => {
      // Update checks are best-effort and should not interrupt the app.
    })
  }
}

export const setupPwa = () => {
  if (typeof window === 'undefined') {
    return
  }
  usePwa.setState({ installed: isStandalone() })
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    usePwa.setState({ installPrompt: event as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => {
    usePwa.setState({ installed: true, installPrompt: null })
  })
  if (!__SDOM_PWA__ || !('serviceWorker' in navigator)) {
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) {
      window.location.reload()
      return
    }
    usePwa.setState({ updateReady: true })
  })
  window.addEventListener('focus', checkForUpdate)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate()
    }
  })
  const register = () => void registerServiceWorker()
  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register, { once: true })
  }
}

export const requestPwaInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
  const prompt = usePwa.getState().installPrompt
  if (!prompt) {
    return 'unavailable'
  }
  try {
    await prompt.prompt()
    const choice = await prompt.userChoice
    usePwa.setState({ installPrompt: null })
    return choice.outcome
  } catch {
    usePwa.setState({ installPrompt: null })
    return 'unavailable'
  }
}

export const applyPwaUpdate = () => {
  const waiting = registration?.waiting
  if (waiting) {
    refreshing = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
    return
  }
  if (usePwa.getState().updateReady) {
    window.location.reload()
  }
}
