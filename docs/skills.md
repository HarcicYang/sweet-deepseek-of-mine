# Skills

Skill 是账号级、按需加载的文本 Bundle。每个 Bundle 以根目录 `SKILL.md` 为入口，可以包含
`references/`、`scripts/`、`assets/` 等相对路径下的 UTF-8 文本文件。格式与 DeepSeek
Harness 的单层目录 Bundle 保持兼容。

```text
weekly-review/
  SKILL.md
  references/report-template.md
  references/metrics.md
  scripts/build-report.py
```

## SKILL.md

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

Read `references/metrics.md` before producing the report.
Use `references/report-template.md` for the final structure.
```

- `name`：必填，账号内唯一，小写 kebab-case。
- `description`：必填，用于模型判断是否加载这个 Skill。
- `whenToUse`：可选，补充适用时机。
- `user-invocable`：是否允许用户通过 `/name` 直接调用，默认 `true`。
- `disable-model-invocation`：是否禁止模型自动加载，默认 `false`。
- `metadata`：可选 JSON 对象，供导入导出和后续扩展使用。

其他 frontmatter 字段不会被当前版本使用，但也不会阻断保存。设置页会在保存后显示警告，
并在 Bundle 原文中保留这些字段，便于导出或兼容其他 Harness 实现。

资源路径必须位于当前 Bundle 内，不允许绝对路径、`..`、反斜杠、隐藏配置目录或嵌套
`SKILL.md`。首版只保存 UTF-8 文本；不支持的二进制文件会在导入时拒绝。

## 加载模型

请求前只把启用且允许自动调用的 Skill 名称、说明和适用时机放进 `skill` 工具定义。
模型判断匹配后调用 `skill({ name })`，返回：

- `SKILL.md` 正文中的 `<skill_instructions>`。
- 其他资源的相对路径、媒体类型和大小。

模型需要资源时再调用：

```text
read_skill_resource({ skill: "weekly-review", path: "references/metrics.md" })
```

只返回选中的单个文本文件，避免把整个 Bundle 一次性放入上下文。用户也可以发送
`/name 参数` 直接调用；匹配到启用且允许用户调用的 Skill 后，客户端只为当前请求加载正文
和资源清单，并从模型输入中移除 `/name` 前缀。

Skill 指令和资源可以指导当前任务，但不能覆盖安全、隐私、身份或工具权限规则。Skill
要求调用 MCP 工具时，仍按 MCP 自身的只读判断和用户确认流程执行。

## 脚本边界

Workers 不执行 `scripts/**`。脚本和普通文件一样只作为 UTF-8 文本保存、导出和按需读取，
用于分析、修改或说明。需要真正执行操作时，应通过 MCP、远程执行器或未来的受控沙箱接入，
而不是把 Skill 做成绕过工具权限的代码执行通道。

## 数据与部署

- Workers 使用 D1 `skills` 和 `skill_files` 表。
- Node / ECS / PC 使用 `SKILL_DB_PATH` 指向的 JSON 文件，默认 `.data/skills.json`。
- 旧版单 `SKILL.md` Skill 会自动迁移为只包含根文件的 Bundle。
- Skill 按账号隔离并跨设备同步。
- 公开分享会隐藏工具结果，因此不会泄露加载过的 Skill 正文或资源内容。
