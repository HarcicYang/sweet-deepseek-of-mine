import { SpeechTranscriptionResponseSchema, apiRoutes } from '@sweet-deepseek/contracts/api'
import { ApiError, request } from './client.js'

export type TtsVoice = 'stella' | 'tide'

/** TTS 输出的裸 PCM 参数：24kHz、单声道、16-bit 小端 */
export const TTS_SAMPLE_RATE = 24000

/** 语音识别：audio 为 WAV（单声道 16-bit PCM）或 Ogg Opus，时长不超过 120 秒、大小不超过 8 MiB */
export const transcribe = async (audio: Blob, signal?: AbortSignal): Promise<string> => {
  const form = new FormData()
  form.append('file', audio, 'recording.wav')
  const response = await request(apiRoutes.speechAsr, {
    method: 'POST',
    body: form,
    signal,
  })
  const body: unknown = await response.json().catch(() => null)
  const parsed = SpeechTranscriptionResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('protocol', 'Invalid speech transcription response')
  }
  return parsed.data.text
}

/** 语音合成：返回裸 PCM 字节流；服务端默认过滤代码块、表格、引用标记与长公式 */
export const synthesize = async (
  text: string,
  voice: TtsVoice,
  signal: AbortSignal
): Promise<ReadableStream<Uint8Array>> => {
  const response = await request(apiRoutes.speechTts, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: true }),
    signal,
  })
  if (!response.body) {
    throw new ApiError('protocol', await response.text())
  }
  return response.body
}
