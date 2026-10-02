# 可替换主题配置

页面在启动时读取 `frontend/public/themes.json`，开发地址是 `/themes.json`，构建后文件位于 `frontend/dist/themes.json`。部署后替换正在提供给浏览器的这份 JSON 文件，再刷新页面，便可更新主题。界面菜单中的“重读配置”也可以加载新内容，无需重新加载聊天界面。

浏览器请求使用 `cache: "no-store"`，最多等待 5 秒。读取失败、JSON 格式错误或字段无效时，页面显示文件和字段的具体错误，保留当前可用主题。第一次打开页面先同步应用应用包内的默认配置，再读取外部配置，因此登录页也有主题。包内默认配置直接从同一份 JSON 导入，没有另存一套手写色板；替换部署目录中的 JSON 后，包内用于读取失败时的默认配置仍来自上次构建。

## 文件结构

`version` 必须为 `1`；`defaultThemeId` 对应用户没有保存皮肤选择时使用的皮肤；`themes` 包含 1 至 16 套主题。每套主题结构如下。这里的空对象只展示结构，不能直接用于运行；新增皮肤时应复制现有完整主题。

```json
{
  "id": "default",
  "label": "默认",
  "description": "可省略的说明",
  "modes": {
    "light": { "colors": {}, "shadows": {} },
    "dark": { "colors": {}, "shadows": {} }
  },
  "typography": {},
  "shape": {},
  "spacing": {},
  "layout": {}
}
```

`id` 不可重复，最多 40 个字符，以小写字母开头，只使用小写字母、数字和连字符。`label` 是选择菜单中的名称，1 至 48 个字符；可省略的 `description` 提供时必须为 1 至 240 个字符。校验规则定义在 `frontend/src/features/theme/schema.ts`。

皮肤和明暗模式分别保存。浏览器的 `yggdrasil-tavern.theme-id` 保存皮肤标识；明暗模式继续使用原来的 `yggdrasil-tavern.theme`，可选 `light`、`dark`、`system`，以前保存的选择仍然有效。`system` 根据操作系统切换当前皮肤的亮色／暗色。保存的皮肤被配置移除时，使用配置中的默认皮肤并显示说明。

## 颜色和阴影

每套主题必须提供完整的 `modes.light` 和 `modes.dark` 配色。`colors` 支持 `#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA`，以及使用数值的 `rgb(0, 0, 0)`、`rgba(0, 0, 0, 0.5)`。RGB 通道范围 0 至 255，透明度 0 至 1；不接受 `var()`、URL、命名颜色或其他 CSS 表达式。

| colors 字段 | 控制内容 |
| --- | --- |
| background / chatBackground | 页面／聊天区背景 |
| panel / panelStrong | 面板／较明显的面板背景 |
| border / text / textMuted | 普通边框／正文／次要文字 |
| primary / primaryHover | 主要按钮和选中状态／主要按钮悬停颜色 |
| link / userBorder / assistantBorder | 链接／用户消息边框／助手消息边框，分别配置 |
| danger / warning | 错误和危险操作／警告颜色 |
| buttonText / accentText | 主要按钮文字／强调文字 |
| surface / surfaceHover / surfaceSelected / surfaceSoft | 普通、悬停、选中和次要内容背景 |
| chipBackground | 标签背景 |
| warningBackground / warningText / dangerBackground | 警告背景／警告文字／错误背景 |
| veilBackground | 隐藏内容背景 |
| codeBackground / codeText | 代码块背景／文字 |
| skeletonLow / skeletonHigh | 加载占位动画两种颜色 |
| glassBackground / revealBackground | 带透明度的面板／展开内容背景 |
| checkerA / checkerB | 透明图片底部两种棋盘格颜色 |
| overlay | 弹窗或侧栏打开时的遮罩 |

`shadows.panel`、`shadows.modal`、`shadows.drawer` 分别控制内容面板、弹窗和侧栏阴影。格式包含 2 至 4 个像素长度和一个颜色，例如 `0 12px 32px rgba(0, 0, 0, 0.2)`。零可不带单位。横向、纵向和扩张距离范围 -128 至 128px；模糊距离 0 至 160px。

运行时继续生成原有 35 个 CSS 变量，并新增 `--color-primary`、`--color-primary-hover`、`--color-link`、`--color-user-border`、`--color-assistant-border`、`--color-danger`、`--color-warning`。原来的 `--green`、`--green-dark`、`--blue`、`--red`、`--amber` 是对应参数的兼容名称；组件应按实际用途引用新的名称。

## 字体、圆角、间距和尺寸

尺寸填写数字，代码自动添加 `px`；行高是比例，不带单位。

| 路径 | 含义 | 接受范围 | CSS 变量 |
| --- | --- | --- | --- |
| typography.fontUI | 界面字体列表 | 最多 240 字符 | --font-ui |
| typography.fontMessage | 消息字体列表 | 最多 240 字符 | --font-message |
| typography.fontSizeUI | 界面基准字号 | 12 至 18px | --font-size-ui |
| typography.fontSizeMessage | 消息正文字号 | 13 至 24px | --font-size-message |
| typography.lineHeightMessage | 消息正文行高 | 1.35 至 2 | --line-height-message |
| shape.radiusSmall | 小控件圆角 | 0 至 12px | --radius-sm |
| shape.radiusMedium | 消息和普通面板圆角 | 0 至 24px | --radius-md |
| shape.radiusLarge | 较大面板圆角 | 0 至 32px | --radius-lg |
| spacing.unit | 常用间距基准 | 2 至 8px | --space-unit |
| layout.sidebarWidth | 桌面会话侧栏宽度 | 220 至 340px | --sidebar-width |
| layout.inspectorWidth | 桌面分支侧栏宽度 | 280 至 400px | --inspector-width |
| layout.messageMaxWidth | 消息正文最大宽度 | 560 至 1000px | --message-max-width |

字体列表可使用 Unicode 字母、数字、空格、逗号、引号和连字符，例如 `Inter, system-ui, "Segoe UI", sans-serif`。配置选择浏览器已经可用的字体，不下载字体文件。移动布局及桌面侧栏是否默认展开由响应式样式和界面状态控制；尺寸配置不替代这些规则。

## 验证

字段缺失、拼写错误、重复标识、未知字段及越界数值会使整份替换配置被拒绝，避免只应用部分参数而混入上一套主题。

在 `frontend` 目录运行：

```powershell
npm test -- src/features/theme
npm run build
```

测试覆盖原有默认主题参数迁移、无保存选择时使用外部默认皮肤、已有明暗选择迁移、系统变化、替换文件重读、失败时保留外观、超时、字段错误和浏览器存储错误。实际布局与交互仍需要浏览器检查。
