# YggdrasilTavern

[English](README.md) · **简体中文**

YggdrasilTavern 是一个本地优先、以真实对话树为核心的角色扮演聊天工作台。分支不是线性聊天记录的视觉副本：每次 swipe、编辑、重新生成和备选开场白都会成为持久化的兄弟节点，下一次模型请求只会编译当前选中的树路径。

当前里程碑是面向单用户的本地 Web 应用，由 FastAPI/SQLite 后端与响应式 React 界面组成。它兼容常见的 SillyTavern 角色卡和世界书格式，但目标不是完整复刻 SillyTavern。

## 为什么是真树？

```text
Session 根节点
├─ 第一条开场白（已选中）
│  └─ 用户消息
│     ├─ Assistant swipe A
│     └─ Assistant swipe B（已选中）
│        └─ 下一条用户消息
└─ 备选开场白
```

- 所有根级开场白都是 session 根节点下的兄弟节点。
- 拥有相同 `parent_id` 的消息互为 sibling/swipe。
- Session 保存当前选中的根消息，每条消息可以指向一个选中的子消息。
- 活跃上下文沿这些选择从根节点一直走到当前叶节点。
- 切换 swipe 或在分支地图中选择节点，会改变后续 Prompt 使用的路径。
- 编辑、复制或重新生成都会创建新的兄弟节点，不会覆盖原消息及其后代。
- 中断或取消生成时，已经生成的 Assistant 部分内容会保留，不会被静默删除。

这套树模型是本项目不可改变的核心约束。

## 功能

### Session 与聊天

- 每个 session 独立保存角色、API Profile/模型、所选树路径、Regex 规则和世界书绑定。
- 支持标题搜索、文件夹、置顶、归档以及归档会话视图。
- 支持 Markdown 和 GitHub-Flavored Markdown 渲染。
- 支持流式正文、流式 thinking、停止、继续和重新生成。
- 支持 swipe 导航、分支地图导航、复制为新 swipe，以及编辑为新 swipe。
- 弹出的 Tree View 会展示完整聊天森林：悬浮或聚焦可预览 swipe，第一次点击固定预览，第二次点击跳转到该节点和分支。
- `first_mes` 和 `alternate_greetings` 会成为根级 swipes，默认选择第一条有效开场白。
- 消息可显示输入、输出、缓存输入和 thinking token，以及生成速度；具体取决于 Provider 是否提供 usage。

### 全局可组合 Prompt Profile

Prompt 结构在所有 session 之间全局共享。默认槽位为：

1. Main Prompt
2. World Info Before
3. Character Description
4. Character Personality
5. Scenario
6. Example Dialogue
7. Pre-History Instruction
8. Chat History
9. World Info After
10. Post-History Instruction

每个槽位都可以启停、通过拖放或箭头调整顺序、选择 `system`、`user` 或 `assistant` role，并用一段全局文本覆盖动态内容。也可以添加和删除自定义槽位。History 槽始终插入当前活跃树路径。

全局配置带 revision，过期浏览器窗口无法静默覆盖更新后的 Prompt Profile。Inspector 还会在生成前展示最终的 Provider-neutral System/Messages 结构和已激活 lore。

全局共享结构不会破坏 session 独立性：

| 全局共享 | 每个 session 独立 |
| --- | --- |
| 槽位顺序、名称、role、启用状态 | 角色及角色字段 |
| 自定义槽位 | 当前选择的树/历史路径 |
| 槽位显式覆盖文本 | API Profile 与模型绑定 |
| Prompt 配置 revision | Regex 规则与世界书选择 |
|  | 用户名与开场白行为 |

每次生成都会保存编译后的 Prompt 快照、Prompt hash、模型、参数、耗时、usage 和终态，因此旧回复仍保留生成当时的配置证据。

### API Profiles 与 Provider

支持以下 Provider 协议：

- OpenAI Responses API
- OpenAI-compatible Chat Completions
- Anthropic Messages API

一个 API Profile 包含名称、协议、Base URL、可选的自定义请求路径、模型 ID、API Key，以及 temperature 等默认参数。Profile 是共享的可变引用：修改 Profile 会立即影响所有绑定它的 session，而不同 session 可以绑定不同的 Profile 和模型。

当 Provider 提供兼容的 `/v1/models` 端点时，可以从远端刷新模型列表；不支持该端点时仍可手动填写模型 ID。

### 角色卡与头像

- 导入 Character Card V1/V2 JSON。
- 导入含 `chara` 或 `ccv3` 元数据的 PNG 角色卡。
- 通过公开 Chub.ai URL 或 `characters/user/slug` 路径导入角色。
- 创建、编辑、删除本地角色，并导出为 normalized V2 JSON。
- 编辑 description、personality、scenario、first message、example dialogue、角色 System Prompt、Post-History Instruction、creator notes、标签和备选开场白。
- 上传 PNG/JPEG/WebP 头像原图，调整缩放和裁剪偏移，按 90 度旋转，并水平或垂直翻转。
- 保存派生的 WebP 展示头像，同时保留原图和变换参数，之后可以重新编辑。

目前不提供 PNG 角色卡导出。

### 世界书

- 导入和导出常见的 SillyTavern 风格世界书 JSON。
- 通过公开 Chub.ai URL 或 `lorebooks/user/slug` 路径导入 lorebook。
- 一个 session 可以同时绑定多本世界书。
- 创建和编辑条目，包括主/次关键词、常驻/选择性激活、区分大小写、完整词匹配、顺序、内容，以及角色设定前/后的插入位置。
- 每本世界书可以配置最近消息扫描深度和激活 lore 的 token 预算。
- 导出时尽可能保留未识别的导入字段。

Lore 激活只扫描当前选中的树路径。SillyTavern 的完整递归 World Info 行为以及所有插入深度语义尚未实现。

### Regex 显示与 Prompt 变换

Regex 规则目前属于当前 session，可作用于四类目标：

- 聊天显示
- 用户消息
- 角色回复
- 发送给模型的 Prompt 文本

支持两种模式：

- **显式替换**：显示或发送替换后的文本。
- **隐式遮罩**：在悬浮、点击、Enter 或 Space 揭示之前，用视觉效果遮住受影响段落。

原始 `Message.content` 永远不会被改写。Outgoing Prompt 规则只能使用显式替换。界面把 `g`、`i`、`m` 和 `s` 表示为可读的匹配选项，不要求用户直接理解 flags 字母。

显示侧规则使用浏览器的 JavaScript `RegExp`；服务端 outgoing 规则使用 Python `re` 实现的可移植子集。如果一条规则需要在两端保持一致，建议只使用两种引擎都支持的语法。

### 响应式界面

- 桌面端三栏工作台，左右侧栏可分别折叠。
- 两个侧栏中的每个 section 都可以独立折叠，并在本地记住状态。
- 较窄桌面窗口使用压缩三栏布局。
- 920 px 及以下使用专用移动布局，资源与 Inspector 通过抽屉打开。
- 粗指针设备上的主要触摸目标最小为 44 px。
- 移动端输入区适配 safe area，资源编辑器使用全屏 modal。
- 支持亮色、暗色和跟随系统三种主题，偏好保存在浏览器中。

这是响应式 Web UI，不是原生移动应用，也不是带离线缓存的可安装 PWA。

## Windows 快速启动

### 前置要求

- Windows PowerShell
- [uv](https://docs.astral.sh/uv/)
- Node.js 和 npm
- Python `>=3.12,<3.14`（`uv` 可以准备 Python 3.12）

克隆仓库并启动前后端开发服务：

```powershell
git clone https://github.com/matthewdm0816/YggdrasilTavern.git
cd YggdrasilTavern
.\start.bat
```

也可以直接运行 PowerShell 脚本：

```powershell
.\scripts\start.ps1
```

脚本会：

- 在缺少时从示例创建 `backend\.env`；
- 使用 `uv` 同步 Python 环境；
- 在缺少 `node_modules` 时安装前端依赖；
- 将后端启动在 `127.0.0.1:8000`，前端启动在 `127.0.0.1:5173`；
- 写入 `backend\server.log` 和 `frontend\dev.log`；
- 使用默认浏览器打开前端。

如果浏览器没有自动打开，请访问 [http://127.0.0.1:5173](http://127.0.0.1:5173)。FastAPI 文档位于 [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)。

停止两个服务：

```powershell
.\stop.bat
```

或：

```powershell
.\scripts\stop.ps1
```

停止脚本会终止正在监听所配置前后端端口的进程。如果手动更改了端口，停止时也需要传入相同端口参数。

### 手动启动开发环境

在仓库根目录启动后端：

```powershell
. .\scripts\uv-env.ps1
uv sync --python 3.12
Copy-Item backend\.env.example backend\.env -ErrorAction SilentlyContinue
uv run uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

在第二个终端启动前端：

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite 开发服务器默认把 `/api` 代理到 `http://127.0.0.1:8000`。

## 第一次使用

1. 打开 **API Profiles**，填写 Provider 协议、Base URL、模型 ID 和 API Key，创建 Profile。
2. 可选地从远端刷新模型列表；也可以继续使用手动填写的模型 ID。
3. 导入或创建角色，并按需要编辑字段和头像。
4. 导入或创建世界书，并编辑其中的条目。
5. 新建 session，绑定角色、API Profile、多本世界书和可选文件夹。
6. 正常聊天；通过 swipe 控件或分支地图在真实树中移动。
7. 在 Inspector 中编辑全局 Prompt Profile、配置当前 session 的 Regex/世界书，并检查最终编译 Prompt。

修改 Profile 后，下一次请求会直接使用新配置，不需要重启应用。

## 数据与安全

- 使用项目脚本启动时，默认数据库是仓库根目录下的 `treechat.db`。
- 启动服务前会自动执行 Alembic migration chain。
- SQLite 启用了 foreign keys、WAL 模式和 busy timeout。
- 直接在界面中输入的 API Key 会以**未加密明文**形式保存在本地 SQLite 数据库中。
- Profile 读取接口只返回 `has_api_key`，绝不会返回已保存 Key。
- Key 不会进入 Prompt 快照、Generation Run、消息历史或前端浏览器存储。
- API 会从校验错误中移除用户提交的原始 input，也不会把 Provider 的原始错误正文直接传给前端。
- UI 与后端都会移除 API Key 首尾空白。
- `.env`、数据库、WAL/SHM、日志、依赖和构建产物都已由 `.gitignore` 排除。

对于旧版/API-only Profile，`api_key_env` 可以引用后端进程环境中已经存在的变量；直接保存的 Key 优先级更高。不要假设写入 `backend\.env` 的任意 Provider Key 会自动导出为进程环境变量。

项目脚本只绑定 loopback，API 本身没有应用级身份验证。在补充身份验证、TLS 和合适的密钥存储方案之前，不要把服务直接暴露到局域网或公网。

Provider 生成、远端模型发现和 Chub 导入会发起外部网络请求。

## 测试与迁移

后端：

```powershell
. .\scripts\uv-env.ps1
uv run pytest
uv run alembic -c backend\alembic.ini upgrade head
```

前端：

```powershell
cd frontend
npm test
npm run build
```

## 项目结构

```text
backend/
  alembic/                 数据库迁移
  app/api/                 FastAPI 路由
  app/services/            树、Prompt、Provider、导入和 token 服务
  tests/                   后端与迁移测试
frontend/
  src/components/          聊天工作台、Inspector、资源编辑器和渲染组件
  src/lib/                 API client、树、Prompt 和 Regex helpers
  src/state/               每个 session 的 UI 状态
scripts/                   Windows 启停与 uv 环境脚本
treechat.db                运行时创建的本地数据库；Git 已忽略
```

## 当前边界

- 仅支持文本流式聊天，不支持多模态输入。
- 不支持 tool calling。
- 不支持 STscript。
- 不支持群聊。
- 尚未实现完整的 SillyTavern 递归 World Info 行为。
- 角色卡/世界书导入面向常见真实格式，不覆盖每个规范版本的所有边缘字段。
- Provider 未返回完整 usage 时，token 数为估算值。
- 只面向本地单用户运行，不是加固后的多用户部署。
- 当前应用界面以简体中文为主；提供英文 README 不代表界面已经完整国际化。
