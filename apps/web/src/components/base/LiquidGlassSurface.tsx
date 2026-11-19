import type { HTMLAttributes, ReactNode } from 'react'
import { Glass, type GlassOptics } from '@samasante/liquid-glass'

/** Keep the upstream material and only match its documented frost to the iOS reference. */
const NATIVE_MATCH_OPTICS: Partial<GlassOptics> = {
  frost: 18,
  specular: 0.55,
}

type LiquidGlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  enabled: boolean
  radius: number
}

/**
 * Uses the upstream liquid-glass material with one screenshot-matched optic.
 * The fallback is the same semantic element so layout stays identical elsewhere.
 */
export const LiquidGlassSurface = ({
  children,
  enabled,
  radius,
  ...props
}: LiquidGlassSurfaceProps) =>
  enabled ? (
    <Glass {...props} optics={NATIVE_MATCH_OPTICS} radius={radius}>
      {children}
    </Glass>
  ) : (
    <div {...props}>{children}</div>
  )
