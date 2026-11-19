import type {
  AssistantBlockParam,
  FileBlockParam,
  MessageParam,
  MessageStreamEvent,
  OutputBlockStart,
  TextBlockParam,
  ToolResultBlockParam,
} from '@sweet-deepseek/contracts'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  ReplyBlock,
  ReplyStatus,
  ToolUsePart,
  UserMessage,
} from './types.js'

/**
 * DeepSeek 用 Files API 的 file_id；Pi 提供商只接受 base64 图片。
 * 没有 serverId 或本地原件的附件不进入请求。
 */
export type PromptImageData = { mediaType: string; data: string }
type PromptFileOptions = {
  useServerFileIds?: boolean
  images?: ReadonlyMap<string, PromptImageData>
}

const toFileBlocks = (
  files: FileAttachment[],
  { useServerFileIds = true, images }: PromptFileOptions = {}
): FileBlockParam[] =>
  files.flatMap((file): FileBlockParam[] => {
    if (file.isImage) {
      const image = images?.get(file.id)
      if (image) {
        return [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
        ]
      }
      return useServerFileIds && file.serverId
        ? [{ type: 'image', source: { type: 'file', file_id: file.serverId } }]
        : []
    }
    return useServerFileIds && file.serverId
      ? [{ type: 'document', source: { type: 'file', file_id: file.serverId } }]
      : []
  })

const toReplyBlock = (block: OutputBlockStart, now: number): ReplyBlock | null => {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, citations: block.citations ?? [] }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
        startedAt: now,
      }
    case 'server_tool_use':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
      return block
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
        inputText:
          typeof block.input === 'object' &&
          block.input !== null &&
          Object.keys(block.input).length > 0
            ? undefined
            : '',
        startedAt: now,
      }
    default:
      return null
  }
}

const updateBlock = (
  reply: AssistantMessage,
  index: number,
  update: (block: ReplyBlock) => ReplyBlock
): AssistantMessage => {
  const block = reply.blocks[index]
  if (!block) {
    return reply
  }
  const blocks = [...reply.blocks]
  blocks[index] = update(block)
  return { ...reply, blocks }
}

/**
 * 把一个流式事件合并进回复：只追加可识别的内容块，用本次请求的临时索引映射处理增量。
 * 跳过的块不占位；续写直接追加到已有内容之后，message_delta 更新结束原因与累计用量。
 */
export const applyEvent = (
  reply: AssistantMessage,
  event: MessageStreamEvent,
  now: number,
  blockIndexes: Map<number, number>
): AssistantMessage => {
  const next: AssistantMessage =
    reply.status === 'streaming' ? reply : { ...reply, status: 'streaming' }
  switch (event.type) {
    case 'message_start':
      return { ...next, usage: event.message.usage ?? next.usage }
    case 'content_block_start': {
      blockIndexes.delete(event.index)
      const block = toReplyBlock(event.content_block, now)
      if (!block) {
        return next
      }
      blockIndexes.set(event.index, next.blocks.length)
      return { ...next, blocks: [...next.blocks, block] }
    }
    case 'content_block_delta': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      const { delta } = event
      return updateBlock(next, index, (block) => {
        if (block.type === 'text' && delta.type === 'text_delta') {
          return { ...block, text: block.text + delta.text }
        }
        if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          return { ...block, thinking: block.thinking + delta.thinking }
        }
        if (block.type === 'thinking' && delta.type === 'signature_delta') {
          return { ...block, signature: (block.signature ?? '') + delta.signature }
        }
        if (block.type === 'text' && delta.type === 'citations_delta') {
          return { ...block, citations: [...(block.citations ?? []), delta.citation] }
        }
        if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
          return { ...block, inputText: (block.inputText ?? '') + delta.partial_json }
        }
        return block
      })
    }
    case 'content_block_stop': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      blockIndexes.delete(event.index)
      return updateBlock(next, index, (block) => {
        if (
          block.type === 'thinking' &&
          block.startedAt !== undefined &&
          block.endedAt === undefined
        ) {
          return { ...block, endedAt: now }
        }
        if (block.type === 'tool_use' && block.endedAt === undefined) {
          if (block.inputText === undefined) {
            return { ...block, endedAt: now }
          }
          try {
            return {
              ...block,
              input: block.inputText.trim() ? (JSON.parse(block.inputText) as unknown) : {},
              inputText: undefined,
              endedAt: now,
            }
          } catch {
            return {
              ...block,
              inputText: undefined,
              inputError: 'Invalid JSON tool arguments',
              endedAt: now,
            }
          }
        }
        return block
      })
    }
    case 'message_delta':
      return {
        ...next,
        stopReason: event.delta.stop_reason,
        stopDetails: event.delta.stop_details,
        usage: event.usage ?? next.usage,
      }
    default:
      return next
  }
}

/**
 * 回复结束：未结束的思考块以当前时间收尾。
 * 安全拒绝（stop_reason: refusal）时已下发的思考与正文不能撤回，按协议要求由客户端丢弃，只保留工具块。
 */
export const settleReply = (
  reply: AssistantMessage,
  status: Extract<ReplyStatus, 'done' | 'stopped' | 'error'>,
  now: number,
  error?: AssistantMessage['error']
): AssistantMessage => ({
  ...reply,
  status,
  error,
  blocks: reply.blocks.flatMap((block): ReplyBlock[] => {
    if (reply.stopReason === 'refusal' && (block.type === 'thinking' || block.type === 'text')) {
      return []
    }
    if (block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined) {
      return [{ ...block, endedAt: now }]
    }
    if (block.type === 'tool_use' && block.endedAt === undefined) {
      if (block.inputText === undefined) {
        return [{ ...block, endedAt: now }]
      }
      try {
        return [
          {
            ...block,
            input: block.inputText.trim() ? (JSON.parse(block.inputText) as unknown) : {},
            inputText: undefined,
            endedAt: now,
          },
        ]
      } catch {
        return [
          {
            ...block,
            inputText: undefined,
            inputError: 'Invalid JSON tool arguments',
            endedAt: now,
          },
        ]
      }
    }
    return [block]
  }),
})

/** 回复里所有文本块拼起来，用于复制与判断是否有回答 */
export const getReplyText = (reply: AssistantMessage) =>
  reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * 正常达到输出上限、被停止或请求出错的回复可续写，便于保留已经收到的内容。
 * 报错或中断发生在工具调用后时，已经完成结果的工具调用可以继续进入下一条消息。
 * 末尾仍有未完成工具调用时，续写会先补执行这些工具。
 * 拒绝回复不能续写。
 * 非报错态的服务端工具块或模板提示不能作为续写前缀。
 */
export const canContinueReply = (reply: AssistantMessage): boolean => {
  if (
    !reply.prefix ||
    reply.stopReason === 'refusal' ||
    reply.blocks.some(
      (block) =>
        (block.type === 'text' && block.isTemplate)
    )
  ) {
    return false
  }
  const hasServerToolBlocks = reply.blocks.some(
    (block) =>
      block.type === 'server_tool_use' ||
      block.type === 'web_search_tool_result' ||
      block.type === 'web_fetch_tool_result'
  )
  if (reply.status !== 'error' && hasServerToolBlocks) {
    return false
  }
  return (
    reply.status === 'stopped' ||
    reply.status === 'error' ||
    (reply.status === 'done' &&
      (reply.stopReason === 'max_tokens' || reply.stopReason === 'tool_use'))
  )
}

/**
 * 已结束或停止且有回答文本的回复才放进上下文；被安全拒绝的轮次不回传。
 * 服务端模板提示不进入上下文。
 */
const isUsableReply = (message: Message): message is AssistantMessage =>
  message.role === 'assistant' &&
  (message.status === 'done' || message.status === 'stopped') &&
  message.stopReason !== 'refusal' &&
  !message.blocks.some((block) => block.type === 'text' && block.isTemplate) &&
  getReplyText(message) !== ''

/** 有文件时用内容块数组：先文件后文本 */
const toUserParam = (
  { content, files }: UserMessage,
  options?: PromptFileOptions
): MessageParam => {
  const blocks = toFileBlocks(files, options)
  return blocks.length === 0
    ? { role: 'user', content }
    : {
        role: 'user',
        content: [...blocks, ...(content ? [{ type: 'text' as const, text: content }] : [])],
      }
}

/**
 * assistant 的内容块按历史与续写场景转换：
 * - 历史思考及其签名不回传；开启思考时续写只保留本轮非空白思考及其签名；
 * - 文本块去掉 citations（服务端忽略）。相邻文本直接拼接，被思考或工具隔开的文本用空行连接；
 *   省略历史思考后仍保留其前后正文的空行；
 * - 工具调用和结果只保留 kind 为 read_link 的块，其他历史工具块不回传；
 * - 阅读链接结果原样回传，保留 signature：服务端解密后将页面拼回该轮提问末尾；
 */
const toAssistantParam = (
  { blocks }: AssistantMessage,
  prefix = false,
  thinking = false
): Extract<MessageParam, { role: 'assistant' }> => {
  const content: AssistantBlockParam[] = []
  // 成功阅读的网页靠签名恢复正文；缺少有效签名时，调用与结果都不回传。
  const unsignedReadLinks = new Set(
    blocks.flatMap((block) =>
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      block.content.type === 'web_fetch_result' &&
      !block.signature?.trim()
        ? [block.tool_use_id]
        : []
    )
  )
  /** 正在拼接的文本块；遇到任何非文本块（含不回传的思考块）就结束 */
  let text: TextBlockParam | null = null
  for (const block of blocks) {
    // 空思考不改变续写位置，也不应把两段正文隔开，导致后端额外插入空行。
    if (prefix && block.type === 'thinking' && !block.thinking.trim()) {
      continue
    }
    if (block.type === 'text') {
      if (text) {
        text.text += block.text
      } else {
        const previous = content.at(-1)
        text = {
          type: 'text',
          text: `${previous?.type === 'text' ? '\n\n' : ''}${block.text}`,
        }
        content.push(text)
      }
      continue
    }
    text = null
    if (prefix && thinking && block.type === 'thinking') {
      // 续写保留本轮思考，历史轮次的思考省略。
      const { type, thinking, signature } = block
      content.push({ type, thinking, signature: signature ?? '' })
    } else if (
      block.type === 'server_tool_use' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.id)
    ) {
      const { type, id, name, input, kind } = block
      content.push({ type, id, name, input, kind })
    } else if (
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.tool_use_id)
    ) {
      content.push(block)
    }
  }
  return {
    role: 'assistant',
    content: content.filter((block) => block.type !== 'text' || block.text !== ''),
  }
}

/** 当前回复中尚未产生结果的模型工具调用。 */
export const getPendingToolUses = (reply: AssistantMessage): ToolUsePart[] => {
  const completed = new Set(
    reply.blocks.flatMap((block) => (block.type === 'tool_result' ? [block.tool_use_id] : []))
  )
  return reply.blocks.filter(
    (block): block is ToolUsePart => block.type === 'tool_use' && !completed.has(block.id)
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * 为一次工具循环追加当前 assistant 的文本、思考、tool_use 与 user tool_result。
 * MCP 工具块只在当前回复内进入请求；最终回答完成后，历史轮次只保留普通正文。
 */
export const toToolLoopMessages = (
  history: Message[],
  question: UserMessage,
  reply: AssistantMessage,
  latestReminder: string | undefined,
  thinking: boolean,
  fileOptions?: PromptFileOptions
): MessageParam[] => {
  const messages = toRequestMessages(
    history,
    question,
    undefined,
    false,
    latestReminder,
    fileOptions
  )
  let assistant: Extract<MessageParam, { role: 'assistant' }> | null = null
  // All results for one assistant tool-use turn must share the immediately following user message.
  let toolResultContent: ToolResultBlockParam[] | null = null
  const assistantContent = (): AssistantBlockParam[] => {
    if (!assistant) {
      assistant = { role: 'assistant', content: [] }
      messages.push(assistant)
    }
    return assistant.content
  }

  for (const block of reply.blocks) {
    if (block.type !== 'tool_result') {
      toolResultContent = null
    }
    if (block.type === 'text') {
      if (block.text) {
        assistantContent().push({ type: 'text', text: block.text })
      }
      continue
    }
    if (block.type === 'thinking') {
      if (thinking && (block.thinking || block.signature)) {
        assistantContent().push({
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature ?? '',
        })
      }
      continue
    }
    if (block.type === 'tool_use') {
      assistantContent().push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: isRecord(block.input) ? block.input : {},
      })
      continue
    }
    if (block.type === 'tool_result') {
      assistant = null
      const result: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content.map((item) => ({ type: 'text', text: item.text })),
        ...(block.isError ? { is_error: true } : {}),
      }
      if (!toolResultContent) {
        toolResultContent = []
        messages.push({ role: 'user', content: toolResultContent })
      }
      toolResultContent.push(result)
      continue
    }
  }
  return messages
}

/** 历史中会进入请求上下文的轮次：提问后紧跟可用回答的才保留 */
export const getContextRounds = (history: Message[]): [UserMessage, AssistantMessage][] => {
  const rounds: [UserMessage, AssistantMessage][] = []
  for (let i = 0; i + 1 < history.length; i++) {
    const [user, reply] = [history[i], history[i + 1]]
    if (user.role === 'user' && isUsableReply(reply)) {
      rounds.push([user, reply])
      i++
    }
  }
  return rounds
}

/**
 * 把会话转成请求的 messages：只保留「提问 + 有回答的回复」成对的轮次，最后接上本轮提问。
 * 失败或没有回答的轮次不进上下文。续写时末尾再带上本轮 assistant。
 */
export const toRequestMessages = (
  history: Message[],
  question: UserMessage,
  prefix?: AssistantMessage,
  thinking = prefix?.thinking ?? false,
  latestReminder?: string,
  fileOptions?: PromptFileOptions
): MessageParam[] => {
  const messages: MessageParam[] = []
  let previousReminder: string | undefined
  const appendReminder = (reminder: string | undefined) => {
    // 仅在当前分支首次出现或内容变化时插入快照；缺少快照的消息保持原有内容。
    if (reminder && reminder !== previousReminder) {
      messages.push({ role: 'latest_reminder', content: reminder })
      previousReminder = reminder
    }
  }
  for (const [user, reply] of getContextRounds(history)) {
    // 历史提问没有文字、附件也都没有 serverId 时，提问为空，连同回答一起省略。
    if (!user.content && toFileBlocks(user.files, fileOptions).length === 0) {
      continue
    }
    appendReminder(reply.latestReminder)
    messages.push(toUserParam(user, fileOptions), toAssistantParam(reply))
  }
  appendReminder(latestReminder)
  messages.push(toUserParam(question, fileOptions))
  if (prefix?.prefix) {
    const assistant = toAssistantParam(prefix, true, thinking)
    // 没有非空白正文或有效思考时直接重发原问题，避免服务端拒绝空 Prefill。
    if (
      assistant.content.some(
        (block) =>
          (block.type === 'text' && block.text.trim()) ||
          (block.type === 'thinking' && block.thinking.trim())
      )
    ) {
      messages.push(assistant)
    }
  }
  return messages
}

/** 思考用时（秒），至少 1 秒 */
export const getThinkingSeconds = (startedAt: number, endedAt: number) =>
  Math.max(1, Math.round((endedAt - startedAt) / 1000))
