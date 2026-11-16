const MCP_HEADERS_AAD_PREFIX = 'mcp-headers:v1:'

export const mcpHeadersAdditionalData = (userId: string, serverId: string): string =>
  `${MCP_HEADERS_AAD_PREFIX}${userId}:${serverId}`

const parseIpv4 = (hostname: string): number[] | null => {
  const parts = hostname.split('.')
  if (parts.length !== 4) {
    return null
  }
  const numbers = parts.map(Number)
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? numbers
    : null
}

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = parseIpv4(hostname)
  if (!parts) {
    return false
  }
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  )
}

const isPrivateHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    isPrivateIpv4(normalized)
  )
}

export const assertAllowedMcpUrl = (value: string, allowPrivateNetwork: boolean): URL => {
  const url = new URL(value)
  if (url.username || url.password) {
    throw new Error('MCP URLs cannot include credentials')
  }
  if (url.protocol !== 'https:' && !(allowPrivateNetwork && url.protocol === 'http:')) {
    throw new Error('MCP URLs must use HTTPS')
  }
  if (url.hash) {
    throw new Error('MCP URLs cannot include fragments')
  }
  if (!allowPrivateNetwork && isPrivateHostname(url.hostname)) {
    throw new Error('Private MCP network addresses are disabled')
  }
  return url
}
