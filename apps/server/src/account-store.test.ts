import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FileAccountStore } from './account-store.js'
import { createSecurityService } from './security.js'

const MASTER_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='

test('file-backed accounts persist only encrypted API keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-'))
  try {
    const filePath = path.join(directory, 'accounts.json')
    const security = await createSecurityService(MASTER_KEY)
    const firstStore = new FileAccountStore(filePath)
    const user = await firstStore.upsertGithubUser({
      githubId: '12345',
      githubLogin: 'octocat',
      avatarUrl: null,
    })
    await firstStore.setApiKey(user.id, await security.encryptApiKey(user.id, 'sk-hidden-value'))

    const raw = await readFile(filePath, 'utf8')
    assert.equal(raw.includes('sk-hidden-value'), false)
    assert.equal(raw.includes('github-access-token'), false)

    const secondStore = new FileAccountStore(filePath)
    const loaded = await secondStore.findUserById(user.id)
    assert.ok(loaded?.apiKey)
    assert.equal(await security.decryptApiKey(user.id, loaded.apiKey), 'sk-hidden-value')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
