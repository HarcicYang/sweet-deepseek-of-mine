import type { CreateMessageRequest } from '@sweet-deepseek/contracts'
import { fetchDeepSeekWebPage, searchDeepSeekWeb } from '../api/client.js'
import {
  DEEPSEEK_READ_URL_TOOL_NAME,
  DEEPSEEK_WEB_SEARCH_TOOL_NAME,
} from './deepseekWebToolNames.js'
import type { ToolResultPart, ToolResultSource } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const deepSeekWebTools = (search: boolean): CreateMessageRequest['tools'] => [
  {
    name: DEEPSEEK_READ_URL_TOOL_NAME,
    description:
      'Read a web page through the DeepSeek Fetch API. Use this for URLs included in the user message or found by search.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The absolute HTTP or HTTPS URL to read.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  ...(search
    ? [
        {
          name: DEEPSEEK_WEB_SEARCH_TOOL_NAME,
          description:
            'Search the live web through the DeepSeek Search API. Use one or more focused queries when the answer needs current or external information.',
          input_schema: {
            type: 'object',
            properties: {
              queries: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 128 },
                minItems: 1,
                description: 'One or more focused search queries.',
              },
            },
            required: ['queries'],
            additionalProperties: false,
          },
        },
      ]
    : []),
]

export const isDeepSeekWebTool = (name: string): boolean =>
  name === DEEPSEEK_WEB_SEARCH_TOOL_NAME || name === DEEPSEEK_READ_URL_TOOL_NAME

type ExecutedWebTool = Pick<ToolResultPart, 'content' | 'isError' | 'sources' | 'page'>

const readQueries = (input: unknown): string[] => {
  if (!isRecord(input)) {
    return []
  }
  const values = Array.isArray(input.queries)
    ? input.queries
    : typeof input.query === 'string'
      ? [input.query]
      : []
  return [
    ...new Set(
      values.flatMap((value) => {
        if (typeof value !== 'string') {
          return []
        }
        const query = value.trim()
        return query ? [query.slice(0, 128)] : []
      })
    ),
  ]
}

const search = async (
  input: unknown,
  signal: AbortSignal,
  knownSources: ToolResultSource[]
): Promise<ExecutedWebTool> => {
  const queries = readQueries(input)
  if (queries.length === 0) {
    throw new Error('DeepSeek web search requires at least one query.')
  }
  const settled = await Promise.allSettled(
    queries.map(async (query) => ({
      query,
      response: await searchDeepSeekWeb({ query, count: 10, need_content: false }, signal),
    }))
  )
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted.', 'AbortError')
  }
  const completed = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []
  )
  if (completed.length === 0) {
    const firstFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    throw firstFailure?.reason ?? new Error('DeepSeek web search failed.')
  }

  const allSources = [...knownSources]
  const sources: ToolResultSource[] = []
  const byUrl = new Map(allSources.map((source) => [source.url, source]))
  const sections: string[] = []
  for (const { query, response } of completed) {
    if (response.results.length === 0) {
      sections.push(`Search query: ${query}\nNo results.`)
      continue
    }
    const lines = [`Search query: ${query}`]
    response.results.forEach((result, index) => {
      let source = byUrl.get(result.url)
      if (!source) {
        source = {
          url: result.url,
          title: result.title,
          snippet: result.snippet.trim() || null,
          siteName: result.site_name,
          siteIcon: result.site_icon,
          publishedAt: result.date,
        }
        byUrl.set(result.url, source)
        allSources.push(source)
        sources.push(source)
      }
      lines.push(
        [
          `${index + 1}. [citation:${allSources.indexOf(source) + 1}] ${result.title}`,
          `URL: ${result.url}`,
          result.summary.trim() || result.snippet.trim(),
        ]
          .filter(Boolean)
          .join('\n')
      )
    })
    sections.push(lines.join('\n\n'))
  }
  const failures = settled.filter((result) => result.status === 'rejected').length
  if (failures > 0) {
    sections.push(`${failures} search query failed. Continue with the results that were returned.`)
  }
  return {
    content: [{ type: 'text', text: sections.join('\n\n---\n\n') }],
    isError: false,
    sources,
  }
}

const readUrl = async (input: unknown, signal: AbortSignal): Promise<ExecutedWebTool> => {
  const url =
    isRecord(input) && typeof input.url === 'string' ? input.url.trim() : ''
  if (!url) {
    throw new Error('DeepSeek Fetch requires a URL.')
  }
  const page = await fetchDeepSeekWebPage(url, signal)
  return {
    content: [
      {
        type: 'text',
        text: [`Title: ${page.title || url}`, `URL: ${url}`, '', page.content].join('\n'),
      },
    ],
    isError: false,
    page: { url, title: page.title || null },
  }
}

export const executeDeepSeekWebTool = async (
  name: string,
  input: unknown,
  signal: AbortSignal,
  knownSources: ToolResultSource[] = []
): Promise<ExecutedWebTool> => {
  if (name === DEEPSEEK_WEB_SEARCH_TOOL_NAME) {
    return await search(input, signal, knownSources)
  }
  if (name === DEEPSEEK_READ_URL_TOOL_NAME) {
    return await readUrl(input, signal)
  }
  throw new Error(`Unknown DeepSeek web tool: ${name}`)
}
