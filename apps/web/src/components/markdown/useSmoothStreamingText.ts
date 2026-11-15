import { useCallback, useEffect, useRef, useState } from 'react'

/** 平滑层刷新间隔，约 30fps；无需跟随 60fps 的 token 更新。 */
const FRAME_INTERVAL = 1000 / 30
/** 每帧至少追平剩余内容的这一比例，避免固定字数导致长回答持续落后。 */
const CATCH_UP_RATIO = 0.18
/** 单帧最多显示的字数，避免大段突发内容一帧跳完。 */
const MAX_CHARS_PER_FRAME = 32
const CITATION_PREFIX = '[citation:'

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** 修正 UTF-16 截断位置，避免把 emoji 等代理对拆开。 */
const safeCodePointBoundary = (text: string, requested: number): number => {
  let end = Math.max(0, Math.min(requested, text.length))
  if (
    end > 0 &&
    end < text.length &&
    isHighSurrogate(text.charCodeAt(end - 1)) &&
    isLowSurrogate(text.charCodeAt(end))
  ) {
    end -= 1
  }
  return end
}

/**
 * 避免把尚未完整到达的引用标记显示成 `[citation:` 半截文本。
 * 标记长度有限，只检查末尾窗口，避免每帧扫描整篇长回复。
 */
const safeCitationBoundary = (text: string, requested: number): number => {
  const end = safeCodePointBoundary(text, requested)
  const windowStart = Math.max(0, end - CITATION_PREFIX.length - 16)
  const markerStart = text.lastIndexOf(CITATION_PREFIX, Math.min(end, text.length - 1))
  if (markerStart < windowStart) {
    return end
  }
  const markerEnd = text.indexOf(']', markerStart)
  return markerEnd === -1 || markerEnd >= end ? Math.min(end, markerStart) : end
}

/** 计算下一帧应显示的可见字符数。 */
export const getNextVisibleLength = (visibleLength: number, targetLength: number): number => {
  if (visibleLength >= targetLength) {
    return targetLength
  }
  const remaining = targetLength - visibleLength
  const step = Math.min(MAX_CHARS_PER_FRAME, Math.max(1, Math.ceil(remaining * CATCH_UP_RATIO)))
  return visibleLength + step
}

/** 把目标截断到适合 Markdown 显示的稳定边界。 */
export const getSmoothBoundary = (text: string, requested: number): number =>
  safeCitationBoundary(text, requested)

const commonPrefixLength = (left: string, right: string): number => {
  const length = Math.min(left.length, right.length)
  let index = 0
  while (index < length && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1
  }
  return index
}

/**
 * 将不均匀到达的流式文本平滑为固定节奏显示。
 * 仅改变可见文本，不改变消息数据；关闭流式状态时立即显示最终内容。
 */
export const useSmoothStreamingText = (content: string, streaming: boolean): string => {
  const [visible, setVisible] = useState(content)
  const contentRef = useRef(content)
  const streamingRef = useRef(streaming)
  const visibleRef = useRef(visible)
  const frameRef = useRef(0)
  const lastFrameRef = useRef(0)

  contentRef.current = content
  streamingRef.current = streaming

  const commitVisible = useCallback((next: string) => {
    if (next === visibleRef.current) {
      return
    }
    visibleRef.current = next
    setVisible(next)
  }, [])

  const schedule = useCallback(() => {
    if (frameRef.current !== 0) {
      return
    }

    const draw = (now: number) => {
      frameRef.current = 0
      if (!streamingRef.current) {
        return
      }

      const target = contentRef.current
      let current = visibleRef.current
      if (!target.startsWith(current)) {
        const common = safeCodePointBoundary(target, commonPrefixLength(target, current))
        commitVisible(target.slice(0, common))
        current = visibleRef.current
      }
      if (current === target) {
        return
      }

      if (now - lastFrameRef.current < FRAME_INTERVAL) {
        frameRef.current = requestAnimationFrame(draw)
        return
      }
      lastFrameRef.current = now
      const nextLength = getSmoothBoundary(
        target,
        getNextVisibleLength(current.length, target.length)
      )
      commitVisible(target.slice(0, nextLength))
      if (nextLength < target.length) {
        frameRef.current = requestAnimationFrame(draw)
      }
    }

    frameRef.current = requestAnimationFrame(draw)
  }, [commitVisible])

  useEffect(() => {
    if (!streaming) {
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
      lastFrameRef.current = 0
      commitVisible(content)
      return
    }
    if (content !== visibleRef.current) {
      schedule()
    }
  }, [commitVisible, content, schedule, streaming])

  useEffect(
    () => () => {
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current)
      }
    },
    []
  )

  return streaming ? visible : content
}
