import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SkillParseError,
  createSkillTool,
  createSkillResourceTool,
  getSlashSkillName,
  parseSkillBundle,
  parseSkillSource,
  renderSkillCatalog,
  renderSkillContent,
  renderSkillResourceContent,
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

test('keeps unsupported frontmatter keys as warnings and validates supported fields', () => {
  const parsed = parseSkillSource(`---
name: portable-skill
description: Preserve metadata used by other Harness implementations.
license: MIT
allowed-tools: read_file
---
Follow the portable workflow.
`)
  assert.equal(parsed.name, 'portable-skill')
  assert.deepEqual(parsed.warnings, [
    {
      code: 'unsupported_frontmatter_keys',
      keys: ['allowed-tools', 'license'],
      omittedCount: 0,
    },
  ])

  assert.throws(
    () =>
      parseSkillSource(`---
name: invalid-supported-field
description: Invalid values still fail.
user-invocable: "yes"
---
Body
`),
    /user-invocable/u
  )
})

test('normalizes a text skill bundle and preserves its resource paths', () => {
  const bundle = parseSkillBundle([
    { path: 'SKILL.md', content: source },
    { path: 'references/checklist.md', content: '# Checklist\n' },
    { path: 'scripts/check.py', content: 'print("ok")\n' },
  ])
  assert.equal(bundle.skill.name, 'release-review')
  assert.deepEqual(
    bundle.files.map((file) => [file.path, file.mediaType]),
    [
      ['SKILL.md', 'text/markdown'],
      ['references/checklist.md', 'text/markdown'],
      ['scripts/check.py', 'text/x-python'],
    ]
  )
})

test('rejects unsafe paths, duplicate files, and missing bundle entrypoints', () => {
  assert.throws(
    () =>
      parseSkillBundle([
        { path: 'SKILL.md', content: source },
        { path: '../secret', content: '' },
      ]),
    /Unsafe skill file path/u
  )
  assert.throws(
    () =>
      parseSkillBundle([
        { path: 'SKILL.md', content: source },
        { path: 'SKILL.md', content: source },
      ]),
    /Duplicate skill file path/u
  )
  assert.throws(
    () => parseSkillBundle([{ path: 'references/only.md', content: 'content' }]),
    /must include SKILL\.md/u
  )
})

test('renders a progressive catalog, tool schema, and loaded skill content', () => {
  const bundle = parseSkillBundle([
    { path: 'SKILL.md', content: source },
    { path: 'references/checklist.md', content: '# Checklist\n' },
  ])
  const parsed = bundle.skill
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
  const resourceTool = createSkillResourceTool([summary])
  assert.ok(resourceTool)
  const content = renderSkillContent({ ...parsed, files: bundle.files })
  assert.match(content, /<skill_content name="release-review">/u)
  assert.match(content, /rollback/u)
  assert.match(content, /references\/checklist\.md/u)
  assert.match(
    renderSkillResourceContent('release-review', 'references/checklist.md', 'text'),
    /skill_resource/u
  )
})

test('resolves exact slash skill commands without consuming normal text', () => {
  assert.equal(getSlashSkillName('/release-review now'), 'release-review')
  assert.equal(getSlashSkillName('/release_review now'), null)
  assert.equal(stripSlashSkillCommand('/release-review now', 'release-review'), 'now')
  assert.equal(stripSlashSkillCommand('/release-review', 'release-review'), '')
})
