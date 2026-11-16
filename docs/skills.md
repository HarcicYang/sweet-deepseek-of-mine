# Skills

Skill 是账号级、按需加载的 Markdown 工作流。首版格式与 DeepSeek Harness 的文本 Skill
保持兼容，不使用可执行脚本，也不通过 Skill manifest 授予工具权限。

## 格式

一个 Skill 对应一份 `SKILL.md`：

```markdown
---
name: weekly-review
description: Summarize the week and plan the next one.
whenToUse: When the user asks for a weekly review.
user-invocable: true
disable-model-invocation: false
metadata:
  owner: personal
---

Lead with outcomes, then risks, then next actions.
```

- `name`：必填，账号内唯一，小写 kebab-case。
- `description`：必填，用于模型判断是否加载这个 Skill。
- `whenToUse`：可选，补充适用时机。
- `user-invocable`：是否允许用户通过 `/name` 直接调用，默认 `true`。
- `disable-model-invocation`：是否禁止模型自动加载，默认 `false`。
- `metadata`：可选 JSON 对象，供导入导出和后续扩展使用。

## 加载模型

请求前只把启用且允许自动调用的 Skill 名称、说明和适用时机放进 `skill` 工具定义。
模型判断匹配后调用 `skill({ name })`，完整正文才作为工具结果进入当前对话。

用户也可以直接发送 `/name 参数`。匹配到启用且允许用户调用的 Skill 后，客户端只为当前
请求加载完整正文，并从模型输入中移除 `/name` 前缀。

Skill 指令可以指导当前任务，但不能覆盖安全、隐私、身份或工具权限规则。Skill 要求调用
MCP 工具时，仍按 MCP 自身的只读判断和用户确认流程执行。

## 数据与部署

- Workers 使用 D1 `skills` 表。
- Node / ECS / PC 使用 `SKILL_DB_PATH` 指向的 JSON 文件，默认 `.data/skills.json`。
- Skill 按账号隔离并跨设备同步。
- 公开分享会隐藏工具结果，因此不会泄露加载过的 Skill 正文。
