import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  files: [
    {
      path: 'SKILL.md',
      mediaType: 'text/markdown',
      sizeBytes: 74,
      content: '---\nname: review\ndescription: Review a change.\n---\n\nReview it.\n',
    },
    {
      path: 'references/checklist.md',
      mediaType: 'text/markdown',
      sizeBytes: 7,
      content: '# Check\n',
    },
  ],
}

test('file-backed skills persist account-scoped bundle files and parsed metadata', async () => {
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
    assert.equal(loaded?.files[1]?.path, 'references/checklist.md')
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

test('file-backed skills migrate legacy single-file records into bundles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-skills-'))
  try {
    const filePath = path.join(directory, 'skills.json')
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        skills: [
          {
            id: 'legacy-skill',
            userId: 'user-1',
            name: 'legacy',
            description: 'Legacy skill.',
            whenToUse: null,
            enabled: true,
            userInvocable: true,
            modelInvocable: true,
            metadata: {},
            source: '---\nname: legacy\ndescription: Legacy skill.\n---\n\nLegacy body.\n',
            instructions: 'Legacy body.',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    )
    const skill = await new FileSkillStore(filePath).findSkill('user-1', 'legacy-skill')
    assert.equal(skill?.files.length, 1)
    assert.equal(skill?.files[0]?.path, 'SKILL.md')
    assert.match(skill?.files[0]?.content ?? '', /Legacy body/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
