import assert from 'node:assert/strict'
import test from 'node:test'
import { findMcpOAuthClient, parseMcpOAuthClients } from './mcp-oauth-clients.js'

const CALLBACK_URL = 'https://app.example.test/api/mcp/oauth/callback'

test('MCP OAuth deployment clients support origin defaults and exact overrides', () => {
  const clients = parseMcpOAuthClients(
    JSON.stringify([
      {
        resource: 'https://api.githubcopilot.com/mcp',
        clientId: 'override-client',
        clientSecret: 'override-secret',
      },
    ]),
    {
      fallbackRedirectUrl: CALLBACK_URL,
      defaults: [
        {
          resource: 'https://api.githubcopilot.com',
          clientId: 'default-client',
          clientSecret: 'default-secret',
          redirectUrl: 'https://app.example.test/api/auth/github/callback',
        },
      ],
    }
  )

  const exact = findMcpOAuthClient(clients, 'https://api.githubcopilot.com/mcp')
  assert.equal(exact?.clientId, 'override-client')
  assert.equal(exact?.redirectUrl, CALLBACK_URL)
  assert.equal(exact?.clientAuthMethod, 'client_secret_post')

  const origin = findMcpOAuthClient(clients, 'https://api.githubcopilot.com/other')
  assert.equal(origin?.clientId, 'default-client')
  assert.equal(origin?.redirectUrl, 'https://app.example.test/api/auth/github/callback')
})

test('MCP OAuth deployment clients reject unsafe or ambiguous configuration', () => {
  assert.throws(
    () =>
      parseMcpOAuthClients(
        JSON.stringify([
          {
            resource: 'http://public.example.test/mcp',
            clientId: 'client',
          },
        ]),
        { fallbackRedirectUrl: CALLBACK_URL }
      ),
    /HTTPS/u
  )
  assert.throws(
    () =>
      parseMcpOAuthClients(
        JSON.stringify([
          {
            resource: 'https://public.example.test/mcp',
            clientId: 'client',
            clientAuthMethod: 'client_secret_post',
          },
        ]),
        { fallbackRedirectUrl: CALLBACK_URL }
      ),
    /requires clientSecret/u
  )
  assert.throws(
    () =>
      parseMcpOAuthClients(
        JSON.stringify([
          {
            resource: 'https://public.example.test/mcp',
            clientId: 'client',
            clientSecret: 'secret',
            typo: true,
          },
        ]),
        { fallbackRedirectUrl: CALLBACK_URL }
      ),
    /Unknown MCP OAuth client field/u
  )
})
