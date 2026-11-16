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

const toRecord = (row: SkillRow): SkillRecord => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description,
  whenToUse: row.when_to_use,
  enabled: row.enabled === 1,
  userInvocable: row.user_invocable === 1,
  modelInvocable: row.model_invocable === 1,
  metadata: parseMetadata(row.metadata_json),
  source: row.source,
  instructions: row.instructions,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class D1SkillStore implements SkillStore {
  constructor(private readonly database: D1Database) {}

  async listSkills(userId: string): Promise<SkillRecord[]> {
    const rows = await this.database
      .prepare('SELECT * FROM skills WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<SkillRow>()
    return rows.results.map(toRecord)
  }

  async findSkill(userId: string, skillId: string): Promise<SkillRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?')
      .bind(skillId, userId)
      .first<SkillRow>()
    return row ? toRecord(row) : null
  }

  async findSkillByName(userId: string, name: string): Promise<SkillRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM skills WHERE name = ? AND user_id = ?')
      .bind(name, userId)
      .first<SkillRow>()
    return row ? toRecord(row) : null
  }

  async createSkill(input: SkillCreate): Promise<SkillRecord> {
    const now = new Date().toISOString()
    const row = await this.database
      .prepare(
        `INSERT INTO skills (
          id, user_id, name, description, when_to_use, enabled,
          user_invocable, model_invocable, metadata_json, source,
          instructions, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`
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
        input.source,
        input.instructions,
        now,
        now
      )
      .first<SkillRow>()
    if (!row) {
      throw new Error('Could not create skill')
    }
    return toRecord(row)
  }

  async updateSkill(
    userId: string,
    skillId: string,
    update: SkillWrite
  ): Promise<SkillRecord | null> {
    const row = await this.database
      .prepare(
        `UPDATE skills SET
          name = ?, description = ?, when_to_use = ?, enabled = ?,
          user_invocable = ?, model_invocable = ?, metadata_json = ?,
          source = ?, instructions = ?, updated_at = ?
         WHERE id = ? AND user_id = ?
         RETURNING *`
      )
      .bind(
        update.name,
        update.description,
        update.whenToUse,
        update.enabled ? 1 : 0,
        update.userInvocable ? 1 : 0,
        update.modelInvocable ? 1 : 0,
        JSON.stringify(update.metadata),
        update.source,
        update.instructions,
        new Date().toISOString(),
        skillId,
        userId
      )
      .first<SkillRow>()
    return row ? toRecord(row) : null
  }

  async deleteSkill(userId: string, skillId: string): Promise<boolean> {
    const result = await this.database
      .prepare('DELETE FROM skills WHERE id = ? AND user_id = ?')
      .bind(skillId, userId)
      .run()
    return result.meta.changes > 0
  }
}
