import { SKILL_ENTRYPOINT } from '@sweet-deepseek/contracts/skills'
import { parseSkillSource, type NormalizedSkillFile } from '@sweet-deepseek/skills'
import { rootSkillFile } from './skill-store.js'
import type { SkillCreate, SkillRecord, SkillStore, SkillWrite } from './skill-store.js'

type SkillRow = {
  id: string
  user_id: string
  name: string
  description: string
  when_to_use: string | null
  enabled: number
  user_invocable: number
  model_invocable: number
  metadata_json: string
  source: string
  instructions: string
  created_at: string
  updated_at: string
}

type SkillFileRow = {
  path: string
  media_type: string
  size_bytes: number
  content: string
}

const parseMetadata = (value: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const toRecord = (row: SkillRow, files: NormalizedSkillFile[]): SkillRecord => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description,
  whenToUse: row.when_to_use,
  enabled: row.enabled === 1,
  userInvocable: row.user_invocable === 1,
  modelInvocable: row.model_invocable === 1,
  metadata: parseMetadata(row.metadata_json),
  files,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const legacyRootFile = (row: SkillRow): NormalizedSkillFile[] => [
  {
    path: SKILL_ENTRYPOINT,
    mediaType: 'text/markdown',
    sizeBytes: new TextEncoder().encode(row.source).byteLength,
    content: row.source,
  },
]

export class D1SkillStore implements SkillStore {
  constructor(private readonly database: D1Database) {}

  private async files(userId: string, skillId: string): Promise<NormalizedSkillFile[]> {
    const rows = await this.database
      .prepare(
        `SELECT path, media_type, size_bytes, content
         FROM skill_files
         WHERE user_id = ? AND skill_id = ?
         ORDER BY CASE WHEN path = ? THEN 0 ELSE 1 END, path`
      )
      .bind(userId, skillId, SKILL_ENTRYPOINT)
      .all<SkillFileRow>()
    return rows.results.map((row) => ({
      path: row.path,
      mediaType: row.media_type,
      sizeBytes: row.size_bytes,
      content: row.content,
    }))
  }

  private fileStatements(
    userId: string,
    skillId: string,
    files: NormalizedSkillFile[]
  ): D1PreparedStatement[] {
    return files.map((file) =>
      this.database
        .prepare(
          `INSERT INTO skill_files (
            user_id, skill_id, path, media_type, size_bytes, content
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(userId, skillId, file.path, file.mediaType, file.sizeBytes, file.content)
    )
  }

  async listSkills(userId: string): Promise<SkillRecord[]> {
    const rows = await this.database
      .prepare('SELECT * FROM skills WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<SkillRow>()
    return rows.results.map((row) => toRecord(row, []))
  }

  async findSkill(userId: string, skillId: string): Promise<SkillRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?')
      .bind(skillId, userId)
      .first<SkillRow>()
    if (!row) {
      return null
    }
    const files = await this.files(userId, skillId)
    return toRecord(row, files.length > 0 ? files : legacyRootFile(row))
  }

  async findSkillByName(userId: string, name: string): Promise<SkillRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM skills WHERE name = ? AND user_id = ?')
      .bind(name, userId)
      .first<SkillRow>()
    if (!row) {
      return null
    }
    const files = await this.files(userId, row.id)
    return toRecord(row, files.length > 0 ? files : legacyRootFile(row))
  }

  async createSkill(input: SkillCreate): Promise<SkillRecord> {
    const root = rootSkillFile(input.files)
    const instructions = parseSkillSource(root.content).instructions
    const now = new Date().toISOString()
    const statements = [
      this.database
        .prepare(
          `INSERT INTO skills (
            id, user_id, name, description, when_to_use, enabled,
            user_invocable, model_invocable, metadata_json, source,
            instructions, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          input.id,
          input.userId,
          input.name,
          input.description,
          input.whenToUse,
          input.enabled ? 1 : 0,
          input.userInvocable ? 1 : 0,
          input.modelInvocable ? 1 : 0,
          JSON.stringify(input.metadata),
          root.content,
          instructions,
          now,
          now
        ),
      ...this.fileStatements(input.userId, input.id, input.files),
    ]
    await this.database.batch(statements)
    const skill = await this.findSkill(input.userId, input.id)
    if (!skill) {
      throw new Error('Could not create skill')
    }
    return skill
  }

  async updateSkill(
    userId: string,
    skillId: string,
    update: SkillWrite
  ): Promise<SkillRecord | null> {
    const root = rootSkillFile(update.files)
    const instructions = parseSkillSource(root.content).instructions
    const statements = [
      this.database
        .prepare(
          `UPDATE skills SET
            name = ?, description = ?, when_to_use = ?, enabled = ?,
            user_invocable = ?, model_invocable = ?, metadata_json = ?,
            source = ?, instructions = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(
          update.name,
          update.description,
          update.whenToUse,
          update.enabled ? 1 : 0,
          update.userInvocable ? 1 : 0,
          update.modelInvocable ? 1 : 0,
          JSON.stringify(update.metadata),
          root.content,
          instructions,
          new Date().toISOString(),
          skillId,
          userId
        ),
      this.database
        .prepare('DELETE FROM skill_files WHERE skill_id = ? AND user_id = ?')
        .bind(skillId, userId),
      ...this.fileStatements(userId, skillId, update.files),
    ]
    await this.database.batch(statements)
    return this.findSkill(userId, skillId)
  }

  async deleteSkill(userId: string, skillId: string): Promise<boolean> {
    const existing = await this.findSkill(userId, skillId)
    if (!existing) {
      return false
    }
    await this.database.batch([
      this.database
        .prepare('DELETE FROM skill_files WHERE skill_id = ? AND user_id = ?')
        .bind(skillId, userId),
      this.database
        .prepare('DELETE FROM skills WHERE id = ? AND user_id = ?')
        .bind(skillId, userId),
    ])
    return true
  }
}
