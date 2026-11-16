import {
  SKILL_BUNDLE_MAX_BYTES,
  SKILL_ENTRYPOINT,
  SKILL_FILE_MAX_LENGTH,
  SKILL_MAX_FILES,
  isSafeSkillFilePath,
  type SkillDetail,
  type SkillFileInput,
  type SkillSummary,
} from '@sweet-deepseek/contracts/skills'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  updateSkill,
} from '../../services/api/client.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16, IconSkillOutline16, IconUploadOutline14 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

const STARTER_SKILL = `---
name: my-skill
description: Describe when this skill should be used.
whenToUse: Use when the user asks for this workflow.
user-invocable: true
disable-model-invocation: false
---

Write the reusable workflow and output requirements here.
`

type Draft = {
  id: string | null
  files: SkillFileInput[]
  enabled: boolean
}

const newDraft = (): Draft => ({
  id: null,
  files: [{ path: SKILL_ENTRYPOINT, content: STARTER_SKILL }],
  enabled: true,
})

const sortFiles = (files: SkillFileInput[]): SkillFileInput[] =>
  [...files].sort((left, right) => {
    if (left.path === SKILL_ENTRYPOINT) {
      return -1
    }
    if (right.path === SKILL_ENTRYPOINT) {
      return 1
    }
    return left.path.localeCompare(right.path)
  })

const draftFiles = (detail: SkillDetail): SkillFileInput[] =>
  sortFiles(detail.files.map(({ path, content }) => ({ path, content })))

const readTextFile = (path: string, bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${path}: binary or non-UTF-8 files are not supported`)
  }
}

const importZip = (bytes: Uint8Array): SkillFileInput[] => {
  const archive = unzipSync(bytes)
  const entries = Object.entries(archive).filter(
    ([path]) =>
      !path.endsWith('/') && !path.startsWith('__MACOSX/') && !path.split('/').includes('.DS_Store')
  )
  const roots = entries
    .map(([path]) => path)
    .filter((path) => path === SKILL_ENTRYPOINT || path.endsWith(`/${SKILL_ENTRYPOINT}`))
  if (roots.length !== 1 || !roots[0]) {
    throw new Error(`ZIP must contain exactly one ${SKILL_ENTRYPOINT}`)
  }
  const root = roots[0]
  const prefix = root === SKILL_ENTRYPOINT ? '' : root.slice(0, -SKILL_ENTRYPOINT.length)
  const bundleEntries = entries.filter(([path]) => !prefix || path.startsWith(prefix))
  if (bundleEntries.length > SKILL_MAX_FILES) {
    throw new Error(`A skill bundle can contain at most ${SKILL_MAX_FILES} files`)
  }
  if (
    bundleEntries.reduce((total, [, content]) => total + content.byteLength, 0) >
    SKILL_BUNDLE_MAX_BYTES
  ) {
    throw new Error('Skill bundle is too large')
  }
  const files = bundleEntries.map(([path, content]) => ({
    path: prefix ? path.slice(prefix.length) : path,
    content: readTextFile(path, content),
  }))
  return sortFiles(files)
}

const exportBundle = (skill: SkillDetail) => {
  const archive = zipSync(
    Object.fromEntries(skill.files.map((file) => [file.path, strToU8(file.content)]))
  )
  const url = URL.createObjectURL(new Blob([archive.slice().buffer], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${skill.name}.zip`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const SkillsSettings = () => {
  const t = useTranslate()
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [draft, setDraft] = useState<Draft>(newDraft)
  const [selectedPath, setSelectedPath] = useState(SKILL_ENTRYPOINT)
  const [newPath, setNewPath] = useState('references/')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      setSkills(await listSkills())
    } catch {
      showToast({ key: 'skillsLoadFailed', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const resetDraft = () => {
    setDraft(newDraft())
    setSelectedPath(SKILL_ENTRYPOINT)
    setNewPath('references/')
    setError(null)
  }

  const save = async () => {
    if (saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = draft.id
        ? await updateSkill(draft.id, { files: draft.files, enabled: draft.enabled })
        : await createSkill({ files: draft.files, enabled: draft.enabled })
      setDraft({ id: saved.id, files: draftFiles(saved), enabled: saved.enabled })
      setSelectedPath(
        saved.files.some((file) => file.path === selectedPath) ? selectedPath : SKILL_ENTRYPOINT
      )
      await load()
      showToast({ key: 'skillSaved' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const edit = async (skill: SkillSummary) => {
    try {
      const detail = await getSkill(skill.id)
      setDraft({ id: detail.id, files: draftFiles(detail), enabled: detail.enabled })
      setSelectedPath(SKILL_ENTRYPOINT)
      setError(null)
      requestAnimationFrame(() => {
        document.getElementById('skill-editor')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      })
    } catch {
      showToast({ key: 'skillLoadFailed', type: 'error' })
    }
  }

  const toggle = async (skill: SkillSummary) => {
    try {
      await updateSkill(skill.id, { enabled: !skill.enabled })
      await load()
    } catch {
      showToast({ key: 'skillSaveFailed', type: 'error' })
    }
  }

  const exportSkill = async (skill: SkillSummary) => {
    try {
      exportBundle(await getSkill(skill.id))
    } catch {
      showToast({ key: 'skillExportFailed', type: 'error' })
    }
  }

  const remove = async (skill: SkillSummary) => {
    try {
      await deleteSkill(skill.id)
      setConfirmingDeleteId(null)
      if (draft.id === skill.id) {
        resetDraft()
      }
      await load()
      showToast({ key: 'skillDeleted' })
    } catch {
      showToast({ key: 'skillDeleteFailed', type: 'error' })
    }
  }

  const importFile = async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        if (file.size > SKILL_BUNDLE_MAX_BYTES * 4) {
          throw new Error('Skill ZIP is too large')
        }
        setDraft({
          id: null,
          files: importZip(new Uint8Array(await file.arrayBuffer())),
          enabled: true,
        })
      } else {
        setDraft({
          id: null,
          files: [
            {
              path: SKILL_ENTRYPOINT,
              content: await file.text(),
            },
          ],
          enabled: true,
        })
      }
      setSelectedPath(SKILL_ENTRYPOINT)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const addFile = () => {
    const path = newPath.trim()
    if (!isSafeSkillFilePath(path)) {
      setError(t('skillFilePathInvalid'))
      return
    }
    if (draft.files.some((file) => file.path === path)) {
      setError(t('skillFileDuplicate'))
      return
    }
    setDraft((current) => ({
      ...current,
      files: sortFiles([...current.files, { path, content: '' }]),
    }))
    setSelectedPath(path)
    setNewPath('references/')
    setError(null)
  }

  const selectedFile = draft.files.find((file) => file.path === selectedPath) ?? draft.files[0]

  return (
    <div className={styles.skillsSettings}>
      <div className={styles.skillsHeadingRow}>
        <div>
          <div className={styles.sectionHeading}>{t('skillsTitle')}</div>
          <p className={styles.sectionDescription}>{t('skillsDescription')}</p>
        </div>
        <Button size="m" variant="outlined" onClick={resetDraft}>
          <IconSkillOutline16 />
          {t('skillNew')}
        </Button>
      </div>

      <div className={styles.skillList}>
        {loading ? <div className={styles.mcpEmpty}>{t('skillsLoading')}</div> : null}
        {!loading && skills.length === 0 ? (
          <div className={styles.mcpEmpty}>{t('skillsEmpty')}</div>
        ) : null}
        {skills.map((skill) => (
          <div className={styles.skillCard} key={skill.id}>
            <div className={styles.skillMain}>
              <div className={styles.skillTitleRow}>
                <strong>{skill.name}</strong>
                <span className={skill.enabled ? styles.mcpEnabled : styles.mcpDisabled}>
                  {t(skill.enabled ? 'skillEnabled' : 'skillDisabled')}
                </span>
                {skill.modelInvocable ? (
                  <span className={styles.skillInvocation}>{t('skillModelInvocable')}</span>
                ) : null}
                {skill.userInvocable ? (
                  <span className={styles.skillInvocation}>{t('skillUserInvocable')}</span>
                ) : null}
              </div>
              <div className={styles.skillDescription}>{skill.description}</div>
              {skill.whenToUse ? (
                <div className={styles.skillWhen}>
                  {t('skillWhenToUse', { when: skill.whenToUse })}
                </div>
              ) : null}
            </div>
            <div className={styles.skillActions}>
              <Button size="s" variant="outlined" onClick={() => void toggle(skill)}>
                {t(skill.enabled ? 'skillDisable' : 'skillEnable')}
              </Button>
              <Button size="s" variant="outlined" onClick={() => void edit(skill)}>
                {t('edit')}
              </Button>
              <Button size="s" variant="outlined" onClick={() => void exportSkill(skill)}>
                <IconDownloadOutline16 />
                {t('skillExport')}
              </Button>
              {confirmingDeleteId === skill.id ? (
                <>
                  <Button size="s" variant="danger" onClick={() => void remove(skill)}>
                    {t('delete')}
                  </Button>
                  <Button size="s" variant="outlined" onClick={() => setConfirmingDeleteId(null)}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  size="s"
                  variant="dangerOutlined"
                  onClick={() => setConfirmingDeleteId(skill.id)}
                >
                  {t('delete')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        className={styles.skillEditor}
        id="skill-editor"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className={styles.skillsHeadingRow}>
          <div className={styles.sectionHeading}>
            {t(draft.id ? 'skillEditTitle' : 'skillAddTitle')}
          </div>
          <Button size="s" variant="outlined" onClick={() => fileInputRef.current?.click()}>
            <IconUploadOutline14 />
            {t('skillImport')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.zip,text/markdown,text/plain,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void importFile(file)
              }
            }}
          />
        </div>
        <p className={styles.sectionDescription}>{t('skillEditorDescription')}</p>
        <div className={styles.skillEditorSplit}>
          <div className={styles.skillFileTree}>
            <div className={styles.skillFilesHeader}>
              <span>{t('skillFilesCount', { count: draft.files.length })}</span>
            </div>
            {draft.files.map((file) => {
              const depth = file.path.split('/').length - 1
              return (
                <button
                  key={file.path}
                  type="button"
                  className={
                    file.path === selectedFile?.path
                      ? styles.skillFileActive
                      : styles.skillFileButton
                  }
                  style={{ paddingLeft: `${8 + depth * 12}px` }}
                  onClick={() => setSelectedPath(file.path)}
                >
                  {file.path}
                </button>
              )
            })}
            <div className={styles.skillAddFile}>
              <input
                value={newPath}
                aria-label={t('skillNewFilePlaceholder')}
                placeholder={t('skillNewFilePlaceholder')}
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addFile()
                  }
                }}
              />
              <Button size="s" variant="outlined" onClick={addFile} disabled={!newPath.trim()}>
                {t('skillAddFile')}
              </Button>
            </div>
          </div>
          <div className={styles.skillFileEditor}>
            <div className={styles.skillFileEditorHeader}>
              <span>{selectedFile?.path ?? SKILL_ENTRYPOINT}</span>
              {selectedFile && selectedFile.path !== SKILL_ENTRYPOINT ? (
                <Button
                  size="s"
                  variant="dangerOutlined"
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      files: current.files.filter((file) => file.path !== selectedFile.path),
                    }))
                    setSelectedPath(SKILL_ENTRYPOINT)
                  }}
                >
                  {t('skillRemoveFile')}
                </Button>
              ) : null}
            </div>
            <textarea
              className={styles.skillSource}
              aria-label={t('skillFileContent', { path: selectedFile?.path ?? SKILL_ENTRYPOINT })}
              value={selectedFile?.content ?? ''}
              maxLength={SKILL_FILE_MAX_LENGTH}
              spellCheck={false}
              onChange={(event) => {
                const content = event.target.value
                setDraft((current) => ({
                  ...current,
                  files: current.files.map((file) =>
                    file.path === selectedFile?.path ? { ...file, content } : file
                  ),
                }))
              }}
              required={selectedFile?.path === SKILL_ENTRYPOINT}
            />
          </div>
        </div>
        <div className={styles.skillEditorFooter}>
          <label className={styles.mcpCheckbox}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            <span>{t('skillEnable')}</span>
          </label>
          <div className={styles.skillEditorActions}>
            {draft.id ? (
              <Button size="m" variant="outlined" disabled={saving} onClick={resetDraft}>
                {t('cancel')}
              </Button>
            ) : null}
            <Button type="submit" size="m" disabled={saving}>
              {t(saving ? 'skillSaving' : 'save')}
            </Button>
          </div>
        </div>
        {error ? <div className={styles.skillError}>{error}</div> : null}
        <div className={styles.skillFormatHint}>{t('skillFormatHint')}</div>
      </form>
    </div>
  )
}
