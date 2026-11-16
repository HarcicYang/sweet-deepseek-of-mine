import {
  SKILL_SOURCE_MAX_LENGTH,
  type SkillDetail,
  type SkillSummary,
} from '@sweet-deepseek/contracts/skills'
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
  source: string
  enabled: boolean
}

const newDraft = (): Draft => ({
  id: null,
  source: STARTER_SKILL,
  enabled: true,
})

const downloadSource = (skill: SkillDetail) => {
  const url = URL.createObjectURL(new Blob([skill.source], { type: 'text/markdown' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${skill.name}.md`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const SkillsSettings = () => {
  const t = useTranslate()
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [draft, setDraft] = useState<Draft>(newDraft)
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

  const save = async () => {
    if (saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = draft.id
        ? await updateSkill(draft.id, { source: draft.source, enabled: draft.enabled })
        : await createSkill({ source: draft.source, enabled: draft.enabled })
      setDraft({ id: saved.id, source: saved.source, enabled: saved.enabled })
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
      setDraft({ id: detail.id, source: detail.source, enabled: detail.enabled })
      setError(null)
      requestAnimationFrame(() => {
        document.getElementById('skill-source')?.scrollIntoView({
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
      downloadSource(await getSkill(skill.id))
    } catch {
      showToast({ key: 'skillExportFailed', type: 'error' })
    }
  }

  const remove = async (skill: SkillSummary) => {
    try {
      await deleteSkill(skill.id)
      setConfirmingDeleteId(null)
      if (draft.id === skill.id) {
        setDraft(newDraft())
      }
      await load()
      showToast({ key: 'skillDeleted' })
    } catch {
      showToast({ key: 'skillDeleteFailed', type: 'error' })
    }
  }

  return (
    <div className={styles.skillsSettings}>
      <div className={styles.skillsHeadingRow}>
        <div>
          <div className={styles.sectionHeading}>{t('skillsTitle')}</div>
          <p className={styles.sectionDescription}>{t('skillsDescription')}</p>
        </div>
        <Button size="m" variant="outlined" onClick={() => setDraft(newDraft())}>
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
            accept=".md,text/markdown,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) {
                return
              }
              void file.text().then((source) => {
                setDraft({
                  id: null,
                  source: source.slice(0, SKILL_SOURCE_MAX_LENGTH),
                  enabled: true,
                })
                setError(null)
              })
            }}
          />
        </div>
        <p className={styles.sectionDescription}>{t('skillEditorDescription')}</p>
        <textarea
          id="skill-source"
          className={styles.skillSource}
          aria-label={t('skillSource')}
          value={draft.source}
          maxLength={SKILL_SOURCE_MAX_LENGTH}
          spellCheck={false}
          onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
          required
        />
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
              <Button
                size="m"
                variant="outlined"
                disabled={saving}
                onClick={() => setDraft(newDraft())}
              >
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
