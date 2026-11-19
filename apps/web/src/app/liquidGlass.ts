const LIQUID_GLASS_ATTRIBUTE = 'data-sdom-liquid-glass'
const NON_SAFARI_IOS = /\b(?:Arc|CriOS|EdgiOS|FxiOS|GSA|OPT|OPiOS|DuckDuckGo)\//
const MIN_SAFARI_VERSION = 26

let enabled = false

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const isIos = (): boolean =>
  /iphone|ipad|ipod/iu.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const safariMajor = (userAgent: string): number => {
  const match = userAgent.match(/\bVersion\/(\d+)(?:\.\d+)*/u)
  return match ? Number(match[1]) : 0
}

const isSafari = (userAgent: string): boolean =>
  /\bSafari\/[\d.]+/u.test(userAgent) && !NON_SAFARI_IOS.test(userAgent)

const supportsBackdropFilter = (): boolean =>
  CSS.supports('-webkit-backdrop-filter', 'blur(1px)') ||
  CSS.supports('backdrop-filter', 'blur(1px)')

/**
 * iOS 26 Safari freezes the OS token at 18.x and advances only Version/26.
 * Treat the Safari/WebKit major as the capability version rather than parsing
 * the misleading OS string.
 */
export const supportsLiquidGlass = (userAgent = navigator.userAgent): boolean =>
  (!__SDOM_PWA__ && new URLSearchParams(window.location.search).get('liquidGlass') === '1') ||
  (isIos() &&
    isStandalone() &&
    isSafari(userAgent) &&
    safariMajor(userAgent) >= MIN_SAFARI_VERSION &&
    supportsBackdropFilter())

export const setupLiquidGlass = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  enabled = supportsLiquidGlass()
  document.documentElement.toggleAttribute(LIQUID_GLASS_ATTRIBUTE, enabled)
  return enabled
}

/** Capability is fixed for the lifetime of an installed web app launch. */
export const useLiquidGlass = (): boolean => enabled
