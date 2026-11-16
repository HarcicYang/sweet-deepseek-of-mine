import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SKILL_ENTRYPOINT } from '@sweet-deepseek/contracts/skills'
import type { NormalizedSkillFile } from '@sweet-deepseek/skills'

export type SkillRecord = {
  id: string
  userId: string
  name: string
  description: string
  whenToUse: string | null
  enabled: boolean
  userInvocable: boolean
  modelInvocable: boolean
  metadata: Record<string, unknown>
  files: NormalizedSkillFile[]
  createdAt: string
  updatedAt: string
}

export type SkillWrite = Pick<
  SkillRecord,
  | 'name'
  | 'description'
  | 'whenToUse'
  | 'enabled'
  | 'userInvocable'
  | 'modelInvocable'
  | 'metadata'
  | 'files'
>

export type SkillCreate = SkillWrite & {
  id: string
  userId: string
}

export type SkillStore = {
  listSkills: (userId: string) => Promise<SkillRecord[]>
  findSkill: (userId: string, skillId: string) => Promise<SkillRecord | null>
  findSkillByName: (userId: string, name: string) => Promise<SkillRecord | null>
  createSkill: (input: SkillCreate) => Promise<SkillRecord>
  updateSkill: (userId: string, skillId: string, update: SkillWrite) => Promise<SkillRecord | null>
  deleteSkill: (userId: string, skillId: string) => Promise<boolean>
}

type SkillDatabase = {
  version: 2
  skills: SkillRecord[]
}

type LegacySkillDatabase = {
  version: 1
  skills: Array<Omit<SkillRecord, 'files'> & { source: string; instructions: string }>
}

const emptyDatabase = (): SkillDatabase => ({ version: 2, skills: [] })
const clone = <Value>(value: Value): Value => structuredClone(value)

const assertUniqueName = (
  skills: SkillRecord[],
  userId: string,
  name: string,
  exceptId?: string
) => {
  if (
    skills.some((skill) => skill.userId === userId && skill.name === name && skill.id !== exceptId)
  ) {
    throw new Error('Skill name already exists')
  }
}

export const rootSkillFile = (files: NormalizedSkillFile[]): NormalizedSkillFile => {
  const root = files.find((file) => file.path === SKILL_ENTRYPOINT)
  if (!root) {
    throw new Error('Skill bundle is missing SKILL.md')
  }
  return root
}

const legacyRecord = (skill: LegacySkillDatabase['skills'][number]): SkillRecord => {
  return {
    id: skill.id,
    userId: skill.userId,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    enabled: skill.enabled,
    userInvocable: skill.userInvocable,
    modelInvocable: skill.modelInvocable,
    metadata: skill.metadata,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    files: [
      {
        path: SKILL_ENTRYPOINT,
        mediaType: 'text/markdown',
        sizeBytes: new TextEncoder().encode(skill.source).byteLength,
        content: skill.source,
      },
    ],
  }
}

export class MemorySkillStore implements SkillStore {
  private readonly skills = new Map<string, SkillRecord>()

  async listSkills(userId: string): Promise<SkillRecord[]> {
    return [...this.skills.values()]
      .filter((skill) => skill.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone)
  }

  async findSkill(userId: string, skillId: string): Promise<SkillRecord | null> {
    const skill = this.skills.get(skillId)
    return skill?.userId === userId ? clone(skill) : null
  }

  async findSkillByName(userId: string, name: string): Promise<SkillRecord | null> {
    const skill = [...this.skills.values()].find(
      (candidate) => candidate.userId === userId && candidate.name === name
    )
    return skill ? clone(skill) : null
  }

  async createSkill(input: SkillCreate): Promise<SkillRecord> {
    assertUniqueName([...this.skills.values()], input.userId, input.name)
    const now = new Date().toISOString()
    const skill: SkillRecord = {
      ...clone(input),
      createdAt: now,
      updatedAt: now,
    }
    this.skills.set(skill.id, clone(skill))
    return clone(skill)
  }

  async updateSkill(
    userId: string,
    skillId: string,
    update: SkillWrite
  ): Promise<SkillRecord | null> {
    const current = this.skills.get(skillId)
    if (!current || current.userId !== userId) {
      return null
    }
    assertUniqueName([...this.skills.values()], userId, update.name, skillId)
    const next: SkillRecord = {
      ...current,
      ...clone(update),
      updatedAt: new Date().toISOString(),
    }
    this.skills.set(skillId, clone(next))
    return clone(next)
  }

  async deleteSkill(userId: string, skillId: string): Promise<boolean> {
    const current = this.skills.get(skillId)
    if (!current || current.userId !== userId) {
      return false
    }
    return this.skills.delete(skillId)
  }
}

export class FileSkillStore implements SkillStore {
  private database: SkillDatabase | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private async exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async load(): Promise<SkillDatabase> {
    if (this.database) {
      return this.database
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || !('skills' in parsed)) {
        throw new Error('Unsupported Skill database format')
      }
      const candidate = parsed as { version?: unknown; skills: unknown }
      if (candidate.version === 1 && Array.isArray(candidate.skills)) {
        this.database = {
          version: 2,
          skills: (candidate as LegacySkillDatabase).skills.map(legacyRecord),
        }
        return this.database
      }
      if (candidate.version !== 2 || !Array.isArray(candidate.skills)) {
        throw new Error('Unsupported Skill database format')
      }
      this.database = parsed as SkillDatabase
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: SkillDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async listSkills(userId: string): Promise<SkillRecord[]> {
    return this.exclusive(async () => {
      const database = await this.load()
      return database.skills
        .filter((skill) => skill.userId === userId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone)
    })
  }

  async findSkill(userId: string, skillId: string): Promise<SkillRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const skill = database.skills.find(
        (candidate) => candidate.id === skillId && candidate.userId === userId
      )
      return skill ? clone(skill) : null
    })
  }

  async findSkillByName(userId: string, name: string): Promise<SkillRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const skill = database.skills.find(
        (candidate) => candidate.userId === userId && candidate.name === name
      )
      return skill ? clone(skill) : null
    })
  }

  async createSkill(input: SkillCreate): Promise<SkillRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      assertUniqueName(database.skills, input.userId, input.name)
      const now = new Date().toISOString()
      const skill: SkillRecord = {
        ...clone(input),
        createdAt: now,
        updatedAt: now,
      }
      database.skills.push(clone(skill))
      await this.persist(database)
      return clone(skill)
    })
  }

  async updateSkill(
    userId: string,
    skillId: string,
    update: SkillWrite
  ): Promise<SkillRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const skill = database.skills.find(
        (candidate) => candidate.id === skillId && candidate.userId === userId
      )
      if (!skill) {
        return null
      }
      assertUniqueName(database.skills, userId, update.name, skillId)
      Object.assign(skill, clone(update), { updatedAt: new Date().toISOString() })
      await this.persist(database)
      return clone(skill)
    })
  }

  async deleteSkill(userId: string, skillId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const database = await this.load()
      const index = database.skills.findIndex(
        (skill) => skill.id === skillId && skill.userId === userId
      )
      if (index === -1) {
        return false
      }
      database.skills.splice(index, 1)
      await this.persist(database)
      return true
    })
  }
}
