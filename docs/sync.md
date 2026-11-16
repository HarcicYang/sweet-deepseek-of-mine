# 云端会话同步

## 数据模型

每个会话独立同步，服务端保存单调递增的 `revision`：

- 创建会话从 `baseRevision: 0` 开始。
- 更新必须携带客户端最后看到的 revision；不一致时返回 `sync_conflict`。
- 删除写入 `deletedAt` 墓碑，其他设备拉取后删除本地缓存。
- 会话载荷带 `schemaVersion`，当前为 `1`。
- 服务端只按已登录用户隔离数据，不接受客户端指定所有者。

## 本地缓存

- IndexedDB 数据库按账号隔离为 `chat-demo:<userId>`。
- 首次启用账号隔离时，旧的 `chat-demo` 数据库在一次成功迁移后删除。
- `syncOutbox` 保存待提交的 upsert/delete。
- `syncState` 保存本地已知的云端 revision。
- `settingsSync` 保存账号设置 revision 和待推送状态。
- 断网时继续写本地缓存，恢复后重试 outbox。

## 冲突策略

- 推送冲突时读取服务端当前版本。
- 较新的版本保留原会话身份。
- 较旧的版本写入新的本地会话 ID，标题追加“冲突副本”，随后上传为新会话。
- 删除冲突不覆盖其他设备的新内容，服务端版本会恢复回本地并提示冲突。

## 设置同步

- 同步 `thinkingMode`、`search`、`ttsVoice` 和 `location`，服务端为每个账号保存一份设置记录。
- 设置修改先写入 localStorage，再进入账号隔离的 IndexedDB 同步状态。
- 设置 revision 冲突时比较客户端 `updatedAt`；较新的设置直接推送，不生成冲突副本。
- `themePreference`、`locale` 和 `siderCollapsed` 属于设备本地偏好，不进入云端同步。
- `GET /api/sync/settings` 返回当前账号设置或 `null`。
- `PUT /api/sync/settings` 携带 `baseRevision` 和完整设置载荷，成功时 revision 加一。

设置载荷当前版本为 `2`：

```json
{
  "schemaVersion": 2,
  "thinkingMode": "high",
  "search": false,
  "ttsVoice": "stella",
  "location": { "region": "CN", "province": "440000", "city": "440300" },
  "updatedAt": 1794729137749
}
```

v1 使用布尔 `thinking`，读取时迁移为 v2：`true` 对应 `high`，`false` 对应
`disabled`。思考档位的 API 证据与约束见 [thinking.md](./thinking.md)。

## 当前范围

- 已同步会话标题、消息分支、消息内容和附件元数据字段。
- 已同步思考、搜索、TTS 音色和位置设置。
- 尚未同步附件二进制、附件对象存储，以及主题、语言和侧栏状态。
- 历史导入/删除全部会重置当前账号的云端会话集合，再上传导入后的本地集合。

当前 upsert 每次提交完整会话快照，单个会话最多允许 10,000 条消息。这套协议适合当前
Node 开发闭环，但不适合直接作为边缘部署的最终形态：请求内存、Worker 限制和数据库单行
大小都会随历史增长成为瓶颈。后续需要改为增量 mutation 或消息分块协议，再实现边缘存储
adapter。
