import assert from 'node:assert/strict'
import test from 'node:test'
import { createSecurityService } from './security.js'

const MASTER_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='

test('session tokens are opaque and hash deterministically', async () => {
  const security = await createSecurityService(MASTER_KEY)
  const first = security.createToken()
  const second = security.createToken()

  assert.notEqual(first, second)
  assert.equal(await security.hashToken(first), await security.hashToken(first))
  assert.notEqual(await security.hashToken(first), await security.hashToken(second))
})

test('API keys round-trip through AES-GCM for the owning account', async () => {
  const security = await createSecurityService(MASTER_KEY)
  const encrypted = await security.encryptApiKey('user-1', 'sk-secret-value')

  assert.notEqual(encrypted.ciphertext, 'sk-secret-value')
  assert.equal(await security.decryptApiKey('user-1', encrypted), 'sk-secret-value')
  await assert.rejects(security.decryptApiKey('user-2', encrypted))
})
