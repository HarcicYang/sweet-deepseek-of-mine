import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FileSkillStore } from './skill-store.js'

const write = {
  name: 'review',
  description: 'Review a change.',
  whenToUse: null,
  enabled: true,
  userInvocable: true,
  modelInvocable: true,
  metadata: { owner: 'platform' },
  source: '---\nname: review\ndescription: Review a change.\n---\n\nReview it.\n',
  instructions: 'Review it.',
}

test('file-backed skills persist account-scoped source and parsed metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-skills-'))
  try {
    const filePath = path.join(directory, 'skills.json')
    const firstStore = new FileSkillStore(filePath)
    const created = await firstStore.createSkill({
      id: 'skill-1',
      userId: 'user-1',
      ...write,
    })
    assert.equal(created.name, 'review')

    const secondStore = new FileSkillStore(filePath)
    const loaded = await secondStore.findSkill('user-1', 'skill-1')
    assert.deepEqual(loaded?.metadata, { owner: 'platform' })
    assert.equal(loaded?.instructions, 'Review it.')
    assert.equal(await secondStore.findSkill('user-2', 'skill-1'), null)

    const updated = await secondStore.updateSkill('user-1', 'skill-1', {
      ...write,
      enabled: false,
    })
    assert.equal(updated?.enabled, false)
    assert.equal((await secondStore.listSkills('user-1'))[0]?.enabled, false)
    assert.equal(await secondStore.deleteSkill('user-1', 'skill-1'), true)
    assert.deepEqual(await secondStore.listSkills('user-1'), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
