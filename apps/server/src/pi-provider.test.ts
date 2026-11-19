import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import type { ChatProxyRequest } from '@sweet-deepseek/contracts/api'
import type { ProviderRecord } from './provider-store.js'
import { createPiSseResponse, createPiTitle } from './pi-provider-runtime.js'

const listen = async (server: http.Server): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine test server port'))
      } else {
        resolve(address.port)
      }
    })
  })

const close = async (server: http.Server): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })

const headersFromIncoming = (headers: http.IncomingHttpHeaders): Headers => {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item)
      }
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

test('Pi custom provider streams through the normalized SSE bridge', async () => {
  const upstream = http.createServer((request, response) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/v1/chat/completions')
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'OK' },
              finish_reason: null,
            },
          ],
        })}\n\n`
      )
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\n`
      )
      response.end('data: [DONE]\n\n')
    })
  })

  try {
    const port = await listen(upstream)
    const request: ChatProxyRequest = {
      providerId: 'custom-test',
      model: 'mock-model',
      system: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'disabled' },
      tools: [],
      safety_check: { level: 'high' },
    }
    const record: ProviderRecord = {
      id: 'custom-test',
      userId: 'user-test',
      kind: 'custom',
      name: 'Custom Test',
      api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models: [
        {
          id: 'mock-model',
          contextWindow: 1_000,
          maxTokens: 100,
          input: ['text'],
          reasoning: false,
          thinkingLevels: [],
        },
      ],
      encryptedApiKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const response = await createPiSseResponse(
      request,
      record,
      'test-key',
      new AbortController().signal
    )
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /event: message_start/)
    assert.match(body, /"type":"text_delta","text":"OK"/)
    assert.match(body, /"stop_reason":"end_turn"/)
    assert.match(body, /event: message_stop/)
  } finally {
    await close(upstream)
  }
})

test('Pi title generation uses the selected provider model', async () => {
  const upstream = http.createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({
          id: 'chatcmpl-title',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: '模型生成标题' }, finish_reason: null }],
        })}\n\n` +
          `data: ${JSON.stringify({
            id: 'chatcmpl-title',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'mock-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n` +
          'data: [DONE]\n\n'
      )
    })
  })

  try {
    const port = await listen(upstream)
    const title = await createPiTitle(
      {
        providerId: 'custom-test',
        model: 'mock-model',
        prompt: '请解释这个版本号为什么合法',
      },
      {
        id: 'custom-test',
        userId: 'user-test',
        kind: 'custom',
        name: 'Custom Test',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: [
          {
            id: 'mock-model',
            contextWindow: 1_000,
            maxTokens: 100,
            input: ['text'],
            reasoning: false,
            thinkingLevels: [],
          },
        ],
        encryptedApiKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'test-key',
      new AbortController().signal
    )
    assert.equal(title, '模型生成标题')
  } finally {
    await close(upstream)
  }
})

test('Pi providers receive base64 image content', async () => {
  let requestBody: Record<string, unknown> | undefined
  const upstream = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      requestBody = JSON.parse(body) as Record<string, unknown>
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({
          id: 'chatcmpl-image',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
        })}\n\n` +
          `data: ${JSON.stringify({
            id: 'chatcmpl-image',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'mock-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n` +
          'data: [DONE]\n\n'
      )
    })
  })
  try {
    const port = await listen(upstream)
    const response = await createPiSseResponse(
      {
        providerId: 'custom-test',
        model: 'mock-model',
        system: 'test',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'YWJj' },
              },
              { type: 'text', text: 'Who is in this image?' },
            ],
          },
        ],
        thinking: { type: 'disabled' },
        tools: [],
        safety_check: { level: 'high' },
      },
      {
        id: 'custom-test',
        userId: 'user-test',
        kind: 'custom',
        name: 'Custom Test',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: [
          {
            id: 'mock-model',
            contextWindow: 1_000,
            maxTokens: 100,
            input: ['text', 'image'],
            reasoning: false,
            thinkingLevels: [],
          },
        ],
        encryptedApiKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'test-key',
      new AbortController().signal
    )
    await response.text()
    assert.match(JSON.stringify(requestBody), /data:image\/png;base64,YWJj/u)
  } finally {
    await close(upstream)
  }
})

test('Pi tool calls are exposed through the client tool-use stream', async () => {
  const upstream = http.createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-tool',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-test',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"query":"x"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`
      )
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-tool',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\n`
      )
      response.end('data: [DONE]\n\n')
    })
  })
  try {
    const port = await listen(upstream)
    const request: ChatProxyRequest = {
      providerId: 'custom-test',
      model: 'mock-model',
      system: 'test',
      messages: [{ role: 'user', content: 'use a tool' }],
      thinking: { type: 'disabled' },
      tools: [
        {
          name: 'lookup',
          description: 'Look up a value',
          input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      safety_check: { level: 'high' },
    }
    const response = await createPiSseResponse(
      request,
      {
        id: 'custom-test',
        userId: 'user-test',
        kind: 'custom',
        name: 'Custom Test',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: [
          {
            id: 'mock-model',
            contextWindow: 1_000,
            maxTokens: 100,
            input: ['text'],
            reasoning: false,
            thinkingLevels: [],
          },
        ],
        encryptedApiKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'test-key',
      new AbortController().signal
    )
    const body = await response.text()
    assert.match(body, /"type":"tool_use"/)
    assert.match(body, /input_json_delta/)
    assert.match(body, /"stop_reason":"tool_use"/)
  } finally {
    await close(upstream)
  }
})

test('OpenCode requests include session and client attribution headers', async () => {
  let requestHeaders: Headers | undefined
  const upstream = http.createServer((request, response) => {
    requestHeaders = headersFromIncoming(request.headers)
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        [
          'event: message_start',
          `data: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: 'msg-test',
              type: 'message',
              role: 'assistant',
              model: 'claude-haiku-5-5',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          })}`,
          '',
          'event: content_block_start',
          `data: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          })}`,
          '',
          'event: content_block_delta',
          `data: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'OK' },
          })}`,
          '',
          'event: content_block_stop',
          `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
          '',
          'event: message_delta',
          `data: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 },
          })}`,
          '',
          'event: message_stop',
          `data: ${JSON.stringify({ type: 'message_stop' })}`,
          '',
          '',
        ].join('\n')
      )
    })
  })
  try {
    const port = await listen(upstream)
    const response = await createPiSseResponse(
      {
        providerId: 'opencode-go',
        model: 'claude-haiku-5-5',
        sessionId: 'conversation-test',
        system: 'test',
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'disabled' },
        tools: [],
        safety_check: { level: 'high' },
      },
      {
        id: 'opencode-go',
        userId: 'user-test',
        kind: 'builtin',
        name: 'OpenCode Go',
        api: null,
        baseUrl: `http://127.0.0.1:${port}`,
        models: [],
        encryptedApiKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'test-key',
      new AbortController().signal
    )
    await response.text()
    assert.equal(requestHeaders?.get('x-opencode-session'), 'conversation-test')
    assert.equal(requestHeaders?.get('x-opencode-client'), "Sweet DeepSeek O'Mine")
  } finally {
    await close(upstream)
  }
})

test('provider attribution and model headers are preserved for other built-ins', async () => {
  const provider = builtinProviders().find((candidate) => candidate.id === 'nvidia')
  const model = provider?.getModels().find((candidate) => candidate.api === 'openai-completions')
  assert.ok(model)
  let requestHeaders: Headers | undefined
  const upstream = http.createServer((request, response) => {
    requestHeaders = headersFromIncoming(request.headers)
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: model.id,
          choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
        })}\n\n` +
          `data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 1,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n` +
          'data: [DONE]\n\n'
      )
    })
  })
  try {
    const port = await listen(upstream)
    const response = await createPiSseResponse(
      {
        providerId: 'nvidia',
        model: model.id,
        sessionId: 'conversation-test',
        system: 'test',
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'disabled' },
        tools: [],
        safety_check: { level: 'high' },
      },
      {
        id: 'nvidia',
        userId: 'user-test',
        kind: 'builtin',
        name: 'NVIDIA',
        api: null,
        baseUrl: `http://127.0.0.1:${port}`,
        models: [],
        encryptedApiKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'test-key',
      new AbortController().signal
    )
    await response.text()
    assert.equal(requestHeaders?.get('x-billing-invoke-origin'), "Sweet DeepSeek O'Mine")
    assert.equal(requestHeaders?.get('nvcf-poll-seconds'), '3600')
  } finally {
    await close(upstream)
  }
})
