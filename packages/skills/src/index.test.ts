import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SkillParseError,
  createSkillTool,
  getSlashSkillName,
  parseSkillSource,
  renderSkillCatalog,
  renderSkillContent,
  stripSlashSkillCommand,
} from './index.js'

const source = `---
name: release-review
description: Review a release and produce a concise risk report.
whenToUse: Before shipping a production release.
user-invocable: true
disable-model-invocation: false
metadata:
  owner: platform
---

Check rollout, observability, and rollback first.
`

test('parses Harness-compatible skill frontmatter and defaults', () => {
  const parsed = parseSkillSource(source)
  assert.equal(parsed.name, 'release-review')
  assert.equal(parsed.whenToUse, 'Before shipping a production release.')
  assert.equal(parsed.userInvocable, true)
  assert.equal(parsed.modelInvocable, true)
  assert.deepEqual(parsed.metadata, { owner: 'platform' })
  assert.match(parsed.instructions, /rollback/u)
})

test('rejects malformed frontmatter, unsafe names, and empty instructions', () => {
  assert.throws(() => parseSkillSource('# no frontmatter'), SkillParseError)
  assert.throws(
    () =>
      parseSkillSource(`---
name: Bad Name
description: invalid
---
Body
`),
    /lowercase kebab-case/u
  )
  assert.throws(
    () =>
      parseSkillSource(`---
name: valid-name
description: valid
---
`),
    /instructions/u
  )
})

test('renders a progressive catalog, tool schema, and loaded skill content', () => {
  const parsed = parseSkillSource(source)
  const summary = {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
  }
  assert.match(renderSkillCatalog([summary]), /release-review/u)
  const tool = createSkillTool([summary])
  assert.ok(tool)
  assert.deepEqual((tool.input_schema.properties as { name: { enum: string[] } }).name.enum, [
    'release-review',
  ])
  const content = renderSkillContent(parsed)
  assert.match(content, /<skill_content name="release-review">/u)
  assert.match(content, /rollback/u)
})

test('resolves exact slash skill commands without consuming normal text', () => {
  assert.equal(getSlashSkillName('/release-review now'), 'release-review')
  assert.equal(getSlashSkillName('/release_review now'), null)
  assert.equal(stripSlashSkillCommand('/release-review now', 'release-review'), 'now')
  assert.equal(stripSlashSkillCommand('/release-review', 'release-review'), '')
})
