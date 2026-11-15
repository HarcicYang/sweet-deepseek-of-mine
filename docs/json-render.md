# JSON-Render 引入规划

状态：第一切片已接入运行时。当前提供静态界面、受控 action 和 Markdown 回退；
表单提交、外部副作用工具和图表交互尚未开放。

JSON-Render 允许模型生成受约束的可交互界面，但它不是任意 HTML、JavaScript 或 CSS 的执行通道。
Markdown 始终是默认格式和失败回退。

## 目标

- 在聊天正文中渲染静态卡片、提示框、表格、图表和简单表单。
- 所有节点、属性、数据规模和交互动作都经过版本化 schema 校验。
- 流式生成时不显示半截 JSON，不因为等待完整文档而阻塞普通 Markdown。
- 无效、未知或不兼容的文档自动回退为可读的 Markdown 或原始代码块。
- 用户看到的主题、移动端布局、键盘操作和中英文文案与应用现有体系一致。

## 非目标

- 不接受任意 HTML、JavaScript、CSS、表达式或远程组件代码。
- 不允许模型直接发起网络请求、提交表单或执行外部副作用。
- 不在浏览器动态加载模型指定的模块。
- 首期不提供自由布局、动画编排、任意颜色或尺寸系统。
- 首期不引入配额、审计后台或复杂权限配置界面。

## 协议装载

模型通过带语言标记的围栏块输出 JSON：

````markdown
```json-render
{
  "version": "1.0",
  "root": {
    "type": "Stack",
    "children": [
      {
        "type": "Callout",
        "tone": "info",
        "title": "提示",
        "content": {
          "type": "Markdown",
          "value": "这是一段**受约束**的内容。"
        }
      }
    ]
  }
}
```
````

围栏块之外的文本继续按现有 Markdown 流式渲染。复杂回答可以按顺序包含最多 4 个独立块，
块之间保留 Markdown 过渡文字；客户端只把已经闭合的 `json-render` 块交给解析和校验流程。
其他 Markdown 代码围栏会整体保留，因此回答中展示 `json-render` 示例代码时不会被误渲染成组件。

## 文档模型

当前使用树形节点，节点由 `type` 判别，不允许透传未声明字段：

- `Stack`：纵向排列子节点。
- `Markdown`：经过现有 Markdown 安全渲染链。
- `Callout`：`info | success | warning | danger` 语义样式。
- `Card`：标题、说明和子节点。
- `Carousel`：2–6 个横向排列的轻量卡片。
- `Table`：纯文本列与行，不支持嵌套交互。
- `Code`：文本和语言标识，复用现有代码高亮。
- `Chart`：条形图和折线图，附屏幕阅读器可读的数据表。

当前限制：

- 最大深度 8，节点数 64。
- 单字段文本 16 KiB，整份文档 64 KiB。
- 图表最多 200 个数据点。
- 字符串枚举和数值范围必须在 schema 中显式声明。
- 当前不提供任意链接、任意颜色或样式字段。

## 校验与回退

协议 schema 和纯校验逻辑放在独立的 `packages/json-render`。React 组件仍位于 `apps/web`，
不进入共享协议包，也不接受模型指定的组件路径。

处理顺序：

1. 客户端检测完整的 `json-render` 围栏块并做本地预检。
2. 客户端调用受认证的 `/api/json-render/validate`，服务端用同一版本 schema 再校验。
3. 客户端只渲染服务端确认兼容的文档。
4. 校验失败、版本未知或服务不可用时，保留原代码块或转成 Markdown 提示。
5. 流结束前，未闭合的 JSON 块显示轻量占位，不展示半截 JSON。

服务端校验不改变聊天 SSE 的直通路径。当前使用独立校验接口；如果后续确有必要，再评估在流中
只缓冲 `json-render` 块并完成增量校验，不能让整轮回答等待 JSON 完成。

## 交互与权限

- 模型只能引用预注册的 `actionId`，不能提供 URL、HTTP 方法或任意处理函数。
- 所有 action 必须由用户手势触发。
- 当前 action 仅支持复制文本和发起一条新的用户 prompt，最多两个。
- prompt action 复用普通消息提交路径；保留输入框草稿，不绕过登录、流式互斥或会话同步。
- 产生写入、删除、发布等副作用的 action 沿用工具权限规则，并在执行前显示确认。
- 表单值属于不可信输入，提交前再次校验，不能直接拼接到请求或 DOM。

## 流式渲染衔接

当前 Markdown 已有显示平滑和渲染耗时节流。JSON-Render 不应按每个 token 解析 JSON：

- 文本段继续使用现有平滑链路。
- `json-render` 块只在自身闭合围栏出现后解析和校验一次，然后立即渲染。
- 多个块保持原始顺序与中间的文字交错，后续文字无需等待整轮回答结束。
- 每轮最多渲染 4 个块；额外块折叠为原始内容，避免无限请求和页面失控。
- 组件动作在回复流式进行期间默认禁用。
- JSON 文档失败时不能清空已经显示的正常 Markdown 内容。

## 分阶段实施

1. 已完成：`packages/json-render` schema、版本、限制、围栏提取和单元测试。
2. 已完成：`Stack`、`Markdown`、`Callout`、`Card`、`Carousel`、`Code`、`Table`、`Chart`。
3. 已完成：Web 消息渲染中的占位、服务端校验和 Markdown 回退。
4. 已完成：复制与 prompt action，以及 DeepSeek 风格基础视觉。
5. 下一阶段：真实模型输出评测、移动端/键盘回归和错误文案细化。
6. 后续：带权限确认的副作用 action，再评估 `Form` 提交。
7. 后续：历史格式演进、组件版本兼容和更丰富的图表类型。

## 当前代码位置

- 共享 schema 和提取器：`packages/json-render/src/`
- 服务端校验：`POST /api/json-render/validate`
- 主回答提取与回退：`apps/web/src/components/json-render/RichMarkdown.tsx`
- 静态组件渲染器：`apps/web/src/components/json-render/JsonRenderView.tsx`
- 模型输出约束：`apps/web/src/services/chat/store.ts`

## 待定事项

- 服务端校验接口的缓存策略：同一文档是否按哈希短期复用。
- JSON-Render 块在历史导出中的保存格式。
- 是否需要模型侧专用 system prompt，还是由用户显式请求渲染界面。
- 组件版本与应用版本不兼容时，是保留原始代码块还是渲染只读静态快照。
