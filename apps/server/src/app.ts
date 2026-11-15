import type { HealthResponse } from '@sweet-deepseek/contracts'
import { Hono } from 'hono'

export const app = new Hono()

app.get('/api/health', (context) => {
  const body: HealthResponse = { status: 'ok' }
  return context.json(body)
})
