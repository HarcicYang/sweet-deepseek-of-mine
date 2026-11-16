import { useId, type SVGProps } from 'react'

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  variant: 'app' | 'glyph' | 'mono'
}

const MARK_PATH =
  'M 250 116 C 278 116 304 124 326 138 C 324 176 346 200 384 202 C 390 219 393 238 393 258 C 393 337 329 401 250 401 C 226 401 204 396 184 386 C 159 396 136 402 120 402 C 107 402 100 392 106 380 C 114 364 120 347 125 328 C 113 307 107 283 107 258 C 107 179 171 116 250 116 Z M 340 278 C 340 226 298 198 250 206 C 218 212 198 238 184 264 C 175 256 168 242 168 228 C 168 221 160 218 155 223 C 144 235 142 254 152 269 C 140 275 134 287 138 297 C 141 303 149 304 155 299 C 164 291 174 286 186 289 C 212 318 256 326 302 316 C 328 310 340 297 340 278 Z'
const SPARK_PATH =
  'M 376 106 C 381.6 131.6 390.4 140.4 416 146 C 390.4 151.6 381.6 160.4 376 186 C 370.4 160.4 361.6 151.6 336 146 C 361.6 140.4 370.4 131.6 376 106 Z'

export const BrandMark = ({ variant, ...props }: BrandMarkProps) => {
  const id = useId().replace(/[^A-Za-z0-9_-]/gu, '')

  if (variant === 'app') {
    const backgroundId = `sdom-background-${id}`
    const glowId = `sdom-glow-${id}`
    return (
      <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 512 512" fill="none">
        <defs>
          <linearGradient id={backgroundId} x1="72" y1="28" x2="440" y2="488">
            <stop stopColor="#5A8BFF" />
            <stop offset="1" stopColor="#2952F6" />
          </linearGradient>
          <radialGradient
            id={glowId}
            cx="0"
            cy="0"
            r="1"
            gradientTransform="translate(184 96) rotate(52) scale(340)"
          >
            <stop stopColor="#FFFFFF" stopOpacity=".22" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="512" height="512" rx="116" fill={`url(#${backgroundId})`} />
        <rect width="512" height="512" rx="116" fill={`url(#${glowId})`} />
        <rect
          x="2"
          y="2"
          width="508"
          height="508"
          rx="114"
          stroke="#FFFFFF"
          strokeOpacity=".2"
          strokeWidth="4"
        />
        <path d={MARK_PATH} fill="#FFFFFF" fillRule="evenodd" />
        <circle cx="298" cy="268" r="12.5" fill="#FFFFFF" />
        <path d={SPARK_PATH} fill="#B7D0FF" />
      </svg>
    )
  }

  if (variant === 'glyph') {
    const markId = `sdom-mark-${id}`
    return (
      <svg {...props} aria-hidden="true" focusable="false" viewBox="76 76 360 360" fill="none">
        <defs>
          <linearGradient id={markId} x1="112" y1="104" x2="400" y2="416">
            <stop stopColor="#2952F6" />
            <stop offset="1" stopColor="#5686FE" />
          </linearGradient>
        </defs>
        <path d={MARK_PATH} fill={`url(#${markId})`} fillRule="evenodd" />
        <circle cx="298" cy="268" r="12.5" fill={`url(#${markId})`} />
        <path d={SPARK_PATH} fill="#5686FE" />
      </svg>
    )
  }

  return (
    <svg {...props} aria-hidden="true" focusable="false" viewBox="80 80 352 352" fill="none">
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
      <circle cx="298" cy="268" r="12.5" fill="currentColor" />
      <path d={SPARK_PATH} fill="currentColor" />
    </svg>
  )
}
