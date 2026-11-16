import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpAuthMode, McpTrustMode } from '@sweet-deepseek/contracts/mcp'
import type { EncryptedValue } from './security.js'

export type McpServerRecord = {
  id: string
  userId: string
  name: string
  slug: string
  url: string
  authMode: McpAuthMode
  trustMode: McpTrustMode
  enabled: boolean
  encryptedHeaders: EncryptedValue | null
  createdAt: string
  updatedAt: string
}

export type McpServerCreate = {
  id: string
  userId: string
  name: string
  slug: string
  url: string
  authMode: McpAuthMode
  trustMode: McpTrustMode
  enabled: boolean
  encryptedHeaders: EncryptedValue | null
}

export type McpServerUpdate = {
  name?: string
  slug?: string
  url?: string
  authMode?: McpAuthMode
  trustMode?: McpTrustMode
  enabled?: boolean
  encryptedHeaders?: EncryptedValue | null
}

export type McpStore = {
  listServers: (userId: string) => Promise<McpServerRecord[]>
  findServer: (userId: string, serverId: string) => Promise<McpServerRecord | null>
  createServer: (input: McpServerCreate) => Promise<McpServerRecord>
  updateServer: (
    userId: string,
    serverId: string,
    update: McpServerUpdate
  ) => Promise<McpServerRecord | null>
  deleteServer: (userId: string, serverId: string) => Promise<boolean>
}

type McpDatabase = {
  version: 1
  servers: McpServerRecord[]
}

const emptyDatabase = (): McpDatabase => ({ version: 1, servers: [] })
const clone = <Value>(value: Value): Value => structuredClone(value)

const assertUniqueSlug = (
  servers: McpServerRecord[],
  userId: string,
  slug: string,
  exceptId?: string
) => {
  if (
    servers.some(
      (server) => server.userId === userId && server.slug === slug && server.id !== exceptId
    )
  ) {
    throw new Error('MCP server slug already exists')
  }
}

export class MemoryMcpStore implements McpStore {
  private readonly servers = new Map<string, McpServerRecord>()

  async listServers(userId: string): Promise<McpServerRecord[]> {
    return [...this.servers.values()]
      .filter((server) => server.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone)
  }

  async findServer(userId: string, serverId: string): Promise<McpServerRecord | null> {
    const server = this.servers.get(serverId)
    return server?.userId === userId ? clone(server) : null
  }

  async createServer(input: McpServerCreate): Promise<McpServerRecord> {
    assertUniqueSlug([...this.servers.values()], input.userId, input.slug)
    const now = new Date().toISOString()
    const server: McpServerRecord = {
      id: input.id,
      userId: input.userId,
      name: input.name,
      slug: input.slug,
      url: input.url,
      authMode: input.authMode,
      trustMode: input.trustMode,
      enabled: input.enabled,
      encryptedHeaders: input.encryptedHeaders,
      createdAt: now,
      updatedAt: now,
    }
    this.servers.set(server.id, clone(server))
    return server
  }

  async updateServer(
    userId: string,
    serverId: string,
    update: McpServerUpdate
  ): Promise<McpServerRecord | null> {
    const current = this.servers.get(serverId)
    if (!current || current.userId !== userId) {
      return null
    }
    if (update.slug) {
      assertUniqueSlug([...this.servers.values()], userId, update.slug, serverId)
    }
    const next: McpServerRecord = {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    }
    this.servers.set(serverId, clone(next))
    return next
  }

  async deleteServer(userId: string, serverId: string): Promise<boolean> {
    const current = this.servers.get(serverId)
    if (!current || current.userId !== userId) {
      return false
    }
    return this.servers.delete(serverId)
  }
}

export class FileMcpStore implements McpStore {
  private database: McpDatabase | null = null
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

  private async load(): Promise<McpDatabase> {
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
        !('servers' in parsed) ||
        !Array.isArray(parsed.servers)
      ) {
        throw new Error('Unsupported MCP database format')
      }
      this.database = parsed as McpDatabase
      this.database.servers = this.database.servers.map((server) => ({
        ...server,
        authMode: server.authMode === 'oauth' ? 'oauth' : 'static',
        trustMode: server.trustMode === 'trust-hints' ? 'trust-hints' : 'prompt',
      }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: McpDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async listServers(userId: string): Promise<McpServerRecord[]> {
    return this.exclusive(async () => {
      const database = await this.load()
      return database.servers
        .filter((server) => server.userId === userId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone)
    })
  }

  async findServer(userId: string, serverId: string): Promise<McpServerRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const server = database.servers.find(
        (candidate) => candidate.id === serverId && candidate.userId === userId
      )
      return server ? clone(server) : null
    })
  }

  async createServer(input: McpServerCreate): Promise<McpServerRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      assertUniqueSlug(database.servers, input.userId, input.slug)
      const now = new Date().toISOString()
      const server: McpServerRecord = {
        id: input.id,
        userId: input.userId,
        name: input.name,
        slug: input.slug,
        url: input.url,
        authMode: input.authMode,
        trustMode: input.trustMode,
        enabled: input.enabled,
        encryptedHeaders: input.encryptedHeaders,
        createdAt: now,
        updatedAt: now,
      }
      database.servers.push(clone(server))
      await this.persist(database)
      return server
    })
  }

  async updateServer(
    userId: string,
    serverId: string,
    update: McpServerUpdate
  ): Promise<McpServerRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const server = database.servers.find(
        (candidate) => candidate.id === serverId && candidate.userId === userId
      )
      if (!server) {
        return null
      }
      if (update.slug) {
        assertUniqueSlug(database.servers, userId, update.slug, serverId)
      }
      Object.assign(server, update, { updatedAt: new Date().toISOString() })
      await this.persist(database)
      return clone(server)
    })
  }

  async deleteServer(userId: string, serverId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const database = await this.load()
      const next = database.servers.filter(
        (server) => server.id !== serverId || server.userId !== userId
      )
      if (next.length === database.servers.length) {
        return false
      }
      database.servers = next
      await this.persist(database)
      return true
    })
  }
}
