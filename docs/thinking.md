# 思考模式与强度

## API 约束

应用调用 DeepSeek 的 Anthropic 兼容 Messages API：

- 模型：`deepseek-flash`、`deepseek-v4-pro`
- 端点：`POST /anthropic/v1/messages`
- 代理实现：`apps/server/src/app.ts`

截至 2026-11-16，DeepSeek 官方文档对该端点说明如下：

- `thinking.type` 可为 `enabled`、`disabled` 或 `adaptive`，其中 `adaptive` 按
  `enabled` 处理。
- `thinking.budget_tokens` 是兼容字段，会被忽略，不会设置思考 token 预算。
- `output_config.effort` 控制思考强度，规范档位为 `low`、`high`、`max`；
  `none` 关闭思考。`minimal`、`medium`、`xhigh`、`ultra` 属于映射别名。
- 显式设置 `thinking.type` 时，它决定是否开启思考；开启且未给 effort 时默认
  强度为 `high`。

来源：

- [创建消息 API](https://api-docs.deepseek.com/zh-cn/api/create-message)
- [思考模式指南](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)

## 应用协议

应用只持久化和展示以下受约束模式：

```ts
type ThinkingMode = 'disabled' | 'low' | 'high' | 'max'
```

请求映射：

```json
{ "thinking": { "type": "disabled" } }
```

```json
{
  "thinking": { "type": "enabled" },
  "output_config": { "effort": "low" }
}
```

`high` 和 `max` 使用相同的 `output_config.effort` 结构。代理拒绝任意字符串、
`budget_tokens`、未知 `output_config` 字段，以及关闭思考时同时携带 effort 的
矛盾请求。

`adaptive` 当前不单独展示，因为它与 `enabled` 等价；别名也不进入产品协议，避免
同一实际档位出现多个选项。

回答消息会保存可选的 `thinkingEffort`，续写时沿用本轮强度；旧消息没有该字段且
`thinking` 为 `true` 时，按 API 默认值 `high` 处理。

## 设置同步

设置同步 schema 版本为 `3`，使用 `thinkingMode` 和 `customInstructions` 字段。v1 的布尔 `thinking`
在读取时迁移：`true` 对应 `high`（旧请求未传 effort 时 API 的默认值），
`false` 对应 `disabled`。
