# JSON-Render 引入规划

状态：基础交互切片已接入运行时。当前提供静态界面、受控 action、受限表单转普通用户消息
以及 Markdown 回退；外部副作用工具和图表交互尚未开放。

JSON-Render 允许模型生成受约束的可交互界面，但它不是任意 HTML、JavaScript 或 CSS 的执行通道。
Markdown 始终是默认格式和失败回退。

## 目标

- 在聊天正文中渲染静态卡片、提示框、图表、图片和受限表单；表格继续使用 Markdown 原生语法。
- 所有节点、属性、数据规模和交互动作都经过版本化 schema 校验。
- 流式生成时不显示半截 JSON，不因为等待完整文档而阻塞普通 Markdown。
- 无效、未知或不兼容的文档自动回退为可读的 Markdown 或原始代码块。
- 用户看到的主题、移动端布局、键盘操作和中英文文案与应用现有体系一致。

## 非目标

- 不接受任意 HTML、JavaScript、CSS、表达式或远程组件代码。
- 不允许模型直接发起网络请求、提交外部副作用或执行任意代码；`Form` 只能把用户输入组成
  一条普通用户消息，不直接调用工具或后端接口。
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
块之间保留 Markdown 过渡文字；现有 mdast 解析器直接识别 `lang="json-render"` 的 code 节点，
因此不会另建一套 Markdown 解析链路。普通代码围栏中的示例也会保持代码行为。

## 文档模型

当前使用树形节点，节点由 `type` 判别，不允许透传未声明字段：

- `Stack`：纵向排列子节点。
- `Markdown`：经过现有 Markdown 安全渲染链。
- `Callout`：`info | success | warning | danger` 语义样式。
- `Card`：标题、说明和子节点。
- `Carousel`：2–6 个横向排列的轻量卡片。
- `Code`：文本和语言标识，复用现有代码高亮。
- `Chart`：条形图和折线图，附屏幕阅读器可读的数据表。
- `Stats`：2–4 个关键指标卡片。
- `Steps`：带 pending、active、done、error 状态的步骤列表。
- `Details`：可折叠的补充说明，避免打断主流程。
- `Badge`：状态和简短元数据标签，可作为独立节点或附在 Card、Carousel、List 项上。
- `List`：2–8 行紧凑列表，每行支持标题、说明、元数据和最多一个 action。
- `Image`：带必填替代文本的 HTTPS 图片，可设置 caption、宽高比和 contain/cover。
- `Form`：1–6 个 text、textarea 或 select 字段；提交时按 `{{字段名}}` 模板生成一条
  普通用户 prompt，复用现有消息提交和流式互斥逻辑。

当前限制：

- 最大深度 8，节点数 64。
- 单字段文本 16 KiB，整份文档 64 KiB。
- 图表最多 200 个数据点；List 最多 8 项，Form 最多 6 个字段。
- 字符串枚举和数值范围必须在 schema 中显式声明。
- 当前不提供任意链接、任意颜色或样式字段；Image 的 `src` 仅接受无凭据的 HTTPS URL，
  图片以 `no-referrer` 和懒加载方式渲染。

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

- 模型只能输出白名单内的 action `kind`，不能提供 URL、HTTP 方法或任意处理函数。
- 所有 action 必须由用户手势触发。
- 当前 action 仅支持复制文本和发起一条新的用户 prompt，每个 Card 最多两个，List 每行最多一个。
- prompt action 复用普通消息提交路径；保留输入框草稿，不绕过登录、流式互斥或会话同步。
- Form 提交只由表单按钮手势触发；浏览器负责必填检查，客户端只替换显式字段占位符，
  prompt 为空或超过消息限制时显示失败提示，不执行网络或外部副作用。
- 产生写入、删除、发布等副作用的 action 沿用工具权限规则，并在执行前显示确认。
- 表单值属于不可信输入，只作为普通消息文本发送；不拼接到 DOM、URL 或工具参数。

## 流式渲染衔接

当前 Markdown 已有显示平滑和渲染耗时节流。JSON-Render 复用同一棵 mdast：

- 文本段继续使用现有平滑链路。
- `json-render` 作为普通 Markdown code 节点解析；内容成为有效 JSON 并通过服务端校验后立即渲染。
- 多个块保持原始顺序与中间的文字交错，后续文字无需等待整轮回答结束。
- 每轮最多渲染 4 个块；额外块折叠为原始内容，避免无限请求和页面失控。
- 组件动作在回复流式进行期间默认禁用。
- JSON 文档失败时不能清空已经显示的正常 Markdown 内容。

## 分阶段实施

1. 已完成：`packages/json-render` schema、版本、限制、mdast 围栏接入和单元测试。
2. 已完成：`Stack`、`Markdown`、`Callout`、`Card`、`Carousel`、`Code`、`Chart`、`Stats`、
   `Steps`、`Details`、`Badge`、`List`、`Image`、`Form`。
3. 已完成：Web 消息渲染中的占位、服务端校验和 Markdown 回退。
4. 已完成：复制与 prompt action、受限 Form prompt 提交，以及 DeepSeek 风格基础视觉。
5. 下一阶段：真实模型输出评测、移动端/键盘回归和错误文案细化。
6. 后续：带权限确认的副作用 action，再评估带数据绑定的 Form action。
7. 后续：历史格式演进、组件版本兼容和更丰富的图表类型。

## 当前代码位置

- 共享 schema 和校验逻辑：`packages/json-render/src/`
- 服务端校验：`POST /api/json-render/validate`
- Markdown 中的 JSON-Render code 节点接入：`apps/web/src/components/markdown/MarkdownAstRenderer.tsx`
- 静态组件渲染器：`apps/web/src/components/json-render/JsonRenderView.tsx`
- 模型输出约束：`apps/web/src/services/chat/store.ts`

## 待定事项

- 服务端校验接口的缓存策略：同一文档是否按哈希短期复用。
- JSON-Render 块在历史导出中的保存格式。
- 是否需要模型侧专用 system prompt，还是由用户显式请求渲染界面。
- 组件版本与应用版本不兼容时，是保留原始代码块还是渲染只读静态快照。
