# 认证与 API Key

## GitHub OAuth

服务端使用 GitHub OAuth Apps 的授权码流程：

- 登录从 `GET /api/auth/github/start` 开始，服务端生成随机 `state` 并写入短期 HttpOnly Cookie。
- GitHub 回调地址固定为 `GITHUB_CALLBACK_URL`，服务端校验 `state` 后在服务端交换 access token。
- GitHub access token 只用于读取用户资料，不返回浏览器，也不写入账户数据库。
- 账户主键使用 GitHub 不可变的数字用户 ID；GitHub 用户名只用于展示。
- 登录成功后签发本项目自己的 HttpOnly、SameSite=Lax 会话 Cookie。
- 会话数据库只保存会话令牌的 SHA-256 哈希，不保存 Cookie 明文。

OAuth scope 目前只有 `read:user`。代码不依赖 GitHub OAuth Apps 的 PKCE 支持，授权码交换使用服务端
`GITHUB_CLIENT_SECRET`。

## API Key

- `PUT /api/account/deepseek-key` 接收用户提交的 DeepSeek API Key。
- Key 使用 AES-256-GCM 加密，`APP_MASTER_KEY` 是部署环境提供的 32 字节主密钥。
- 附加认证数据绑定账户 ID，复制到其他账户的密文无法解密。
- `GET /api/account/deepseek-key` 只返回是否已配置，不返回 Key 明文或掩码。
- 聊天代理在请求时临时解密 Key，服务端不记录 Key、鉴权头或完整请求内容。

## 聊天代理

`POST /api/chat` 需要有效登录会话和已配置的 API Key。服务端校验共享请求 schema 后，
以 `stream: true` 请求 DeepSeek Anthropic 兼容接口，并把 SSE 响应直接流式转发给客户端。
客户端断开时上游请求随之中止；默认超时为 15 分钟，可通过
`DEEPSEEK_REQUEST_TIMEOUT_MS` 调整。

## 附件与语音

- `POST /api/files` 和 `DELETE /api/files/:fileId` 代理 Files API；附件 multipart 以限长流
  转发，不在边缘完整读入内存，文件格式与 purpose 由上游校验。
- `POST /api/speech/asr` 以同样的限长流代理语音识别 multipart 请求，限制音频大小为 8 MiB。
- `POST /api/speech/tts` 校验文本和音色参数后，把 PCM 字节流直接转发给浏览器。
- 上游返回的无效 Key 会转换为 `invalid_api_key`，不会和登录会话失效混淆。

## 当前限制

- Node adapter 使用本地 JSON 文件保存账户数据，用于当前开发闭环；云端部署需要实现相同
  `AccountStore` 接口的数据库 adapter。
- 尚未实现邮箱登录、账户合并或 GitHub 账户解绑。
