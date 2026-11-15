const textEncoder = new TextEncoder()
const SESSION_TOKEN_BYTES = 32
const API_KEY_AAD_PREFIX = 'deepseek-api-key:v1:'

export type EncryptedApiKey = {
  version: 1
  algorithm: 'AES-GCM'
  iv: string
  ciphertext: string
}

export type SecurityService = {
  createToken: () => string
  hashToken: (token: string) => Promise<string>
  encryptApiKey: (userId: string, apiKey: string) => Promise<EncryptedApiKey>
  decryptApiKey: (userId: string, encrypted: EncryptedApiKey) => Promise<string>
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.trim().replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const importMasterKey = async (secret: string): Promise<CryptoKey> => {
  const raw = fromBase64Url(secret)
  if (raw.byteLength !== 32) {
    throw new Error('APP_MASTER_KEY must decode to exactly 32 bytes')
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export const createSecurityService = async (masterKeySecret: string): Promise<SecurityService> => {
  const masterKey = await importMasterKey(masterKeySecret)

  return {
    createToken: () => toBase64Url(crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES))),
    hashToken: async (token) =>
      toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(token)))),
    encryptApiKey: async (userId, apiKey) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: textEncoder.encode(`${API_KEY_AAD_PREFIX}${userId}`),
        },
        masterKey,
        textEncoder.encode(apiKey)
      )
      return {
        version: 1,
        algorithm: 'AES-GCM',
        iv: toBase64Url(iv),
        ciphertext: toBase64Url(new Uint8Array(ciphertext)),
      }
    },
    decryptApiKey: async (userId, encrypted) => {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64Url(encrypted.iv),
          additionalData: textEncoder.encode(`${API_KEY_AAD_PREFIX}${userId}`),
        },
        masterKey,
        fromBase64Url(encrypted.ciphertext)
      )
      return new TextDecoder().decode(plaintext)
    },
  }
}
