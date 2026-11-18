import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FileSyncStore } from './sync-store.js'

test('file-backed sync settings migrate version 1 storage and persist revisions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-sync-'))
  try {
    const filePath = path.join(directory, 'sync.json')
    await writeFile(filePath, `${JSON.stringify({ version: 1, sessions: [] })}\n`)
    const firstStore = new FileSyncStore(filePath)
    assert.equal(await firstStore.getSettings('user-1'), null)

    const payload = {
      schemaVersion: 4 as const,
      thinkingMode: 'high' as const,
      customInstructions: 'Prefer concise answers.',
      defaultModel: null,
      search: false,
      ttsVoice: 'tide' as const,
      location: { region: 'CN', province: '440000', city: '440300' },
      updatedAt: 100,
    }
    const saved = await firstStore.putSettings('user-1', 0, payload)
    assert.equal(saved.revision, 1)

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number
      sessions: unknown[]
      settings: unknown[]
    }
    assert.equal(raw.version, 2)
    assert.deepEqual(raw.sessions, [])
    assert.equal(raw.settings.length, 1)

    const secondStore = new FileSyncStore(filePath)
    const loaded = await secondStore.getSettings('user-1')
    assert.equal(loaded?.revision, 1)
    assert.deepEqual(loaded?.payload, payload)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('file-backed sync settings migrate legacy boolean thinking on read', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-sync-'))
  try {
    const filePath = path.join(directory, 'sync.json')
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 2,
        sessions: [],
        settings: [
          {
            userId: 'user-1',
            revision: 1,
            clientUpdatedAt: 100,
            serverUpdatedAt: '2026-11-16T00:00:00.000Z',
            payload: {
              schemaVersion: 1,
              thinking: true,
              search: false,
              ttsVoice: 'tide',
              location: null,
              updatedAt: 100,
            },
          },
        ],
      })}\n`
    )
    const store = new FileSyncStore(filePath)
    assert.deepEqual((await store.getSettings('user-1'))?.payload, {
      schemaVersion: 4,
      thinkingMode: 'high',
      customInstructions: '',
      defaultModel: null,
      search: false,
      ttsVoice: 'tide',
      location: null,
      updatedAt: 100,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('file-backed sync settings migrate version 2 settings without custom instructions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-sync-'))
  try {
    const filePath = path.join(directory, 'sync.json')
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 2,
        sessions: [],
        settings: [
          {
            userId: 'user-1',
            revision: 1,
            clientUpdatedAt: 100,
            serverUpdatedAt: '2026-11-16T00:00:00.000Z',
            payload: {
              schemaVersion: 2,
              thinkingMode: 'low',
              search: true,
              ttsVoice: 'stella',
              location: null,
              updatedAt: 100,
            },
          },
        ],
      })}\n`
    )
    const store = new FileSyncStore(filePath)
    assert.deepEqual((await store.getSettings('user-1'))?.payload, {
      schemaVersion: 4,
      thinkingMode: 'low',
      customInstructions: '',
      defaultModel: null,
      search: true,
      ttsVoice: 'stella',
      location: null,
      updatedAt: 100,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
