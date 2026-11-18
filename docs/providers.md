# 模型提供商

通用模型调用复用 MIT 许可的 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi)：

- Pi 提供 Provider 目录、模型元数据、工具调用、reasoning、usage 和协议实现。
- 服务端只保存账号级 Provider 实例、模型配置和加密凭据。
- 聊天请求使用 `providerId + modelId`，前端不接触 Provider API Key。
- Pi 的输出事件在服务端转换为项目现有的 Anthropic 风格 SSE，避免重写聊天 UI 和工具循环。

## 内置 Provider

首期内置：

- Anthropic
- OpenAI
- OpenRouter
- Groq
- Moonshot AI
- Google Gemini
- xAI

内置目录和模型能力来自 Pi。内置 Provider 也可以填写代理 Base URL。

## 自定义 Provider

支持三类兼容端点：

- `openai-completions`
- `anthropic-messages`
- `openai-responses`

自定义 Provider 需要 Base URL、API Key 和至少一个模型。模型配置包括 ID、上下文窗口、最大输出、输入模态、是否支持 reasoning 和可用 reasoning 档位。

## DeepSeek 专用路径

DeepSeek 官方 Provider 继续使用现有专用代理，以保留：

- `deepseek_web_search`
- `deepseek_read_url`
- Files API 附件
- ASR / TTS
- `latest_reminder`
- 标题生成和安全参数

非 DeepSeek Provider 当前只开放文本、图片输入能力声明、工具调用和 reasoning；附件原件、语音、原生搜索仍只支持 DeepSeek。

## 凭据与数据

- Provider API Key 使用 AES-256-GCM 加密。
- 附加认证数据绑定 `userId + providerId`。
- 浏览器只读取 Provider 摘要、模型目录和是否已配置，不读取 Key。
- Node adapter 默认写入 `.data/providers.json`。
- Workers adapter 使用 D1 的 `provider_profiles` 表。
