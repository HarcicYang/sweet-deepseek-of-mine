export class McpToolNotFoundError extends Error {
  constructor() {
    super('MCP tool not found')
    this.name = 'McpToolNotFoundError'
  }
}

export class McpApprovalRequiredError extends Error {
  constructor() {
    super('MCP tool requires explicit approval')
    this.name = 'McpApprovalRequiredError'
  }
}
