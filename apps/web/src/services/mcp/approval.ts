import { create } from 'zustand'

export type McpApprovalRequest = {
  id: string
  serverName: string
  toolName: string
  input: unknown
  resolve: (approved: boolean) => void
}

const useMcpApproval = create<{ request: McpApprovalRequest | null }>(() => ({ request: null }))

export const requestMcpApproval = (
  request: Omit<McpApprovalRequest, 'id' | 'resolve'>,
  signal: AbortSignal
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const id = crypto.randomUUID()
    const finish = (approved: boolean) => {
      signal.removeEventListener('abort', onAbort)
      if (useMcpApproval.getState().request?.id === id) {
        useMcpApproval.setState({ request: null })
      }
      resolve(approved)
    }
    const onAbort = () => finish(false)
    signal.addEventListener('abort', onAbort, { once: true })
    useMcpApproval.setState({
      request: {
        ...request,
        id,
        resolve: finish,
      },
    })
  })

export const useMcpApprovalRequest = () => useMcpApproval((state) => state.request)

export const resolveMcpApproval = (approved: boolean) => {
  useMcpApproval.getState().request?.resolve(approved)
}
