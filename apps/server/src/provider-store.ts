import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProviderApi, ProviderModelInput } from '@sweet-deepseek/contracts/providers'
import type { EncryptedValue } from './security.js'

export type ProviderRecord = {
  id: string
  userId: string
  kind: 'builtin' | 'custom'
  name: string
  api: ProviderApi | null
  baseUrl: string | null
  models: ProviderModelInput[]
  encryptedApiKey: EncryptedValue | null
  createdAt: string
  updatedAt: string
}

export type ProviderWrite = Omit<ProviderRecord, 'userId' | 'createdAt' | 'updatedAt'>

export type ProviderStore = {
  listProviders: (userId: string) => Promise<ProviderRecord[]>
  findProvider: (userId: string, providerId: string) => Promise<ProviderRecord | null>
  createProvider: (userId: string, provider: ProviderWrite) => Promise<ProviderRecord>
  updateProvider: (
    userId: string,
    providerId: string,
    provider: ProviderWrite
  ) => Promise<ProviderRecord | null>
  deleteProvider: (userId: string, providerId: string) => Promise<boolean>
}

type ProviderDatabase = {
  version: 1
  providers: ProviderRecord[]
}

const emptyDatabase = (): ProviderDatabase => ({ version: 1, providers: [] })
const clone = <Value>(value: Value): Value => structuredClone(value)

export class MemoryProviderStore implements ProviderStore {
  private readonly providers = new Map<string, ProviderRecord>()

  async listProviders(userId: string): Promise<ProviderRecord[]> {
    return [...this.providers.values()]
      .filter((provider) => provider.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone)
  }

  async findProvider(userId: string, providerId: string): Promise<ProviderRecord | null> {
    const provider = this.providers.get(providerId)
    return provider?.userId === userId ? clone(provider) : null
  }

  async createProvider(userId: string, input: ProviderWrite): Promise<ProviderRecord> {
    if (this.providers.has(input.id)) {
      throw new Error('Provider already exists')
    }
    const now = new Date().toISOString()
    const provider: ProviderRecord = {
      ...input,
      userId,
      createdAt: now,
      updatedAt: now,
    }
    this.providers.set(provider.id, clone(provider))
    return provider
  }

  async updateProvider(
    userId: string,
    providerId: string,
    input: ProviderWrite
  ): Promise<ProviderRecord | null> {
    const current = this.providers.get(providerId)
    if (!current || current.userId !== userId) {
      return null
    }
    const provider: ProviderRecord = {
      ...input,
      id: current.id,
      userId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.providers.set(providerId, clone(provider))
    return provider
  }

  async deleteProvider(userId: string, providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId)
    return provider?.userId === userId ? this.providers.delete(providerId) : false
  }
}

export class FileProviderStore implements ProviderStore {
  private database: ProviderDatabase | null = null
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

  private async load(): Promise<ProviderDatabase> {
    if (this.database) {
      return this.database
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('version' in parsed) ||
        parsed.version !== 1 ||
        !('providers' in parsed) ||
        !Array.isArray(parsed.providers)
      ) {
        throw new Error('Unsupported provider database format')
      }
      this.database = parsed as ProviderDatabase
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: ProviderDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async listProviders(userId: string): Promise<ProviderRecord[]> {
    return this.exclusive(async () => {
      const database = await this.load()
      return database.providers
        .filter((provider) => provider.userId === userId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone)
    })
  }

  async findProvider(userId: string, providerId: string): Promise<ProviderRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const provider = database.providers.find(
        (candidate) => candidate.id === providerId && candidate.userId === userId
      )
      return provider ? clone(provider) : null
    })
  }

  async createProvider(userId: string, input: ProviderWrite): Promise<ProviderRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      if (database.providers.some((provider) => provider.id === input.id)) {
        throw new Error('Provider already exists')
      }
      const now = new Date().toISOString()
      const provider: ProviderRecord = {
        ...input,
        userId,
        createdAt: now,
        updatedAt: now,
      }
      database.providers.push(clone(provider))
      await this.persist(database)
      return provider
    })
  }

  async updateProvider(
    userId: string,
    providerId: string,
    input: ProviderWrite
  ): Promise<ProviderRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const provider = database.providers.find(
        (candidate) => candidate.id === providerId && candidate.userId === userId
      )
      if (!provider) {
        return null
      }
      Object.assign(provider, input, {
        id: provider.id,
        userId,
        createdAt: provider.createdAt,
        updatedAt: new Date().toISOString(),
      })
      await this.persist(database)
      return clone(provider)
    })
  }

  async deleteProvider(userId: string, providerId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const database = await this.load()
      const next = database.providers.filter(
        (provider) => provider.id !== providerId || provider.userId !== userId
      )
      if (next.length === database.providers.length) {
        return false
      }
      database.providers = next
      await this.persist(database)
      return true
    })
  }
}
