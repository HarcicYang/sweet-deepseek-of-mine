import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import type { ChatProxyRequest } from '@sweet-deepseek/contracts/api'
import type { ProviderRecord } from './provider-store.js'
import { createPiSseResponse } from './pi-provider-runtime.js'

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
