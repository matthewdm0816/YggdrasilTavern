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

- 每个 session 独立保存角色、所选树路径、Regex 规则和世界书绑定。新建聊天必须选择角色；标题留空时自动使用角色名。
- 当前 API Profile 是浏览器本地的全局选择，不是永久绑定到当前 chat session 的配置。
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
| 槽位显式覆盖文本 | 用户名与开场白行为 |
| Prompt 配置 revision | Regex 规则与世界书选择 |

每次生成都会保存编译后的 Prompt 快照、Prompt hash、模型、参数、耗时、usage 和终态，因此旧回复仍保留生成当时的配置证据。

### API Profiles 与 Provider

支持以下 Provider 协议：

- OpenAI Responses API
- OpenAI-compatible Chat Completions
- Anthropic Messages API

一个 API Profile 包含名称、协议、Base URL、可选的自定义请求路径、模型 ID、API Key，以及 temperature 等默认参数。当前选中的 Profile 是浏览器本地的全局选择，在开始生成时生效；它不会作为固定配置持久化到 chat session。每次 generation 仍会在运行元数据中记录实际使用的模型和请求参数。

Profile 默认使用 256K token 的输入上限与 32K token 的输出上限，两者都可以编辑。若所选模型报告了更小的能力，YggdrasilTavern 会采用较小的生效值。编译后的 Prompt 超过输入上限时，只会从当前所选树路径中移除最旧的完整消息；固定 Prompt 与最近两条历史始终保留，仍无法容纳时会明确报错，不会从单条消息中间静默切断。

当 Provider 提供兼容的 `/v1/models` 端点时，可以从远端刷新模型列表；不支持该端点时仍可手动填写模型 ID。

模型能力发现取决于 Provider：Anthropic 可以报告独立的输入/输出上限，Kimi 可以报告输入与输出共享的总 Context；OpenAI 标准 `/v1/models` 只提供模型身份信息，不提供 Context 上限。未报告的值会保持未知，可在 Profile 中手动配置。

Thinking Level 会按 OpenAI Responses、OpenAI-compatible Chat Completions 或 Anthropic Messages 协议映射到相应的 Provider 参数。如果所选远端模型不支持该设置，界面会明确展示 Provider 错误，不会静默改写请求。

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

启动脚本在 `.yggdrasil-runtime/` 中记录本次启动的进程编号、启动时间和可执行文件路径。停止脚本核对记录后终止对应进程及其子进程；没有记录或记录已过期时会明确报告并保留其他进程。如果更改了端口，停止时也需要传入相同端口参数。手动启动和旧启动器创建的服务使用其原有进程管理方式。

### 局域网访问与 HTTPS

默认命令仍只绑定 loopback。需要让同一局域网中的其他设备访问界面时，请通过 batch launcher 传入 `-Lan`：

```powershell
.\start.bat -Lan
```

LAN 模式会交互式要求输入用户名和至少 12 个字符的密码。密码和每次启动新生成的 32-byte session 签名 secret 只通过后端子进程环境传递，不会进入进程命令行、日志或 `backend\.env`。重新启动 LAN 模式会生成新的签名 secret，因此已有登录 session 会失效。

只有 Vite 会绑定 `0.0.0.0`；Uvicorn 始终留在 `127.0.0.1`。这样，局域网客户端无法绕过身份验证直接连接后端端口；浏览器的 `/api` 流量会经过 Vite 的 loopback proxy，并由后端完成鉴权。切换 LAN/HTTPS 模式前请先停止已有服务，让启动脚本确认两个配置端口都未被占用。

启用 HTTPS 时，需要同时提供 PEM 证书和对应的 PEM 私钥。TLS 在 Vite 这一外层终止；代理到 Uvicorn 的链路仍是在本机 loopback 上的 HTTP：

```powershell
.\start.bat -Lan `
  -HttpsCertificate "C:\certs\Yggdrasil LAN\yggdrasil-cert.pem" `
  -HttpsPrivateKey "C:\certs\Yggdrasil LAN\yggdrasil-key.pem"
```

不加 `-Lan` 也可以使用相同参数启用本机 HTTPS。在带身份验证的 HTTPS 模式中，脚本还会自动启用 Cookie 的 `Secure` 标志。启动脚本会把实际后端 origin 传给 Vite，因此 `/api` proxy 使用的是与后端一致的 `http://127.0.0.1:<port>`，不是写死的错误 scheme。

使用自签名证书或私有 CA 时：

- 证书的 Subject Alternative Name（SAN）必须包含客户端实际使用的所有名称，通常包括 `localhost`、`127.0.0.1`、电脑的局域网 IP 以及局域网 DNS 名。现代浏览器不会只凭匹配的 Common Name 判定证书有效。
- 每台客户端设备都必须信任签发 CA 或该证书，并通过另一条可信渠道核对 fingerprint；只在服务端电脑上信任，并不会让手机或其他电脑自动信任。
- 私钥应放在仓库外并限制访问权限，绝对不要提交到 Git。

HTTP LAN 模式只有身份验证，没有传输加密。能接触该网络的人可能截获或篡改密码、签名 Cookie、Prompt 与回复。只应在隔离且可信的局域网中临时使用；优先启用 HTTPS，用主机防火墙限制前端端口，并且不要把这个开发服务器直接暴露到公网。

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
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite 开发服务器默认把 `/api` 代理到 `http://127.0.0.1:8000`。`scripts/start.ps1` 启动 Vite 时会显式传入 `YGGDRASIL_BACKEND_ORIGIN`，启用 HTTPS 时还会传入证书/私钥路径。

## 第一次使用

1. 打开 **API Profiles**，填写 Provider 协议、Base URL、模型 ID 和 API Key，创建 Profile，并把它选为当前浏览器的全局 Profile。
2. 可选地从远端刷新模型列表；也可以继续使用手动填写的模型 ID。
3. 导入或创建角色，并按需要编辑字段和头像。
4. 导入或创建世界书，并编辑其中的条目。
5. 新建聊天并选择必需的角色、多本世界书和可选文件夹；标题留空时会自动使用角色名。
6. 正常聊天；通过 swipe 控件或分支地图在真实树中移动。
7. 在 Inspector 中编辑全局 Prompt Profile、配置当前 session 的 Regex/世界书，并检查最终编译 Prompt。

下一次生成会使用浏览器当前选中的 API Profile；切换 Profile 不需要重启应用，也不会改写 chat session 配置。

## 数据与安全

- 使用项目脚本启动时，默认数据库是仓库根目录下的 `treechat.db`。
- 启动服务前会自动执行 Alembic migration chain。
- SQLite 启用了 foreign keys、WAL 模式和 busy timeout。
- 直接在界面中输入的 API Key 会以**未加密明文**形式保存在本地 SQLite 数据库中。
- Profile 读取接口只返回 `has_api_key`，绝不会返回已保存 Key。
- 修改 Profile 的协议、Base URL 或请求路径时必须重新输入 API Key，防止隐藏的旧 Key 被静默发送到新地址。
- Key 不会进入 Prompt 快照、Generation Run、消息历史或前端浏览器存储。
- API 会从校验错误中移除用户提交的原始 input，也不会把 Provider 的原始错误正文直接传给前端。
- UI 与后端都会移除 API Key 首尾空白。
- `.env`、数据库、WAL/SHM、日志、依赖和构建产物都已由 `.gitignore` 排除。

对于旧版/API-only Profile，`api_key_env` 可以引用后端进程环境中已经存在的变量；直接保存的 Key 优先级更高。不要假设写入 `backend\.env` 的任意 Provider Key 会自动导出为进程环境变量。

默认启动仍只绑定 loopback。显式 `-Lan` 模式只暴露 Vite 端口，并在后端启用签名 Cookie 身份验证；只要局域网并非完全可信，就应同时提供 HTTPS 证书参数。这仍是开发服务器，不是适合公网的加固部署。

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
npm run contract:check
npm run build
```

## 项目结构

```text
backend/
  alembic/                        数据库迁移
  app/api/                        按资源拆分的 HTTP 接口与流式事件编码
  app/services/generation.py      生成流程、部分内容保存和终态处理
  app/services/prompt_builder.py  提示词数据读取与独立编译函数
  app/services/provider_protocols/ 各模型协议转换与共用网络传输
  app/database.py                 每个应用独立的数据库连接与请求会话
  app/database_schema.py          数据库迁移、旧库接管和中断恢复
  tests/                          后端、生成并发和迁移测试
frontend/
  src/features/chat/              每个会话的生成、取消、分支选择和树缓存协调
  src/components/                 工作台与按功能拆分的资源、配置编辑组件
  src/lib/api/                    请求客户端、流解析和接口类型
  scripts/api-contract.mjs        根据后端 OpenAPI 生成和检查前端类型
  src/state/                      每个会话的草稿和消息编辑状态
scripts/                          Windows 启停、进程身份记录和环境脚本
.github/workflows/verify.yml       持续集成检查
treechat.db                       运行时创建的本地数据库；Git 已忽略
```

## 模块边界与验证

- HTTP 接口接收请求并编码响应；生成服务协调聊天树、提示词编译、模型调用和保存操作。业务错误由应用入口统一转换为 HTTP 响应。
- 提示词编译器使用读取阶段生成的数据副本，可以在数据库连接关闭后运行。预览和生成共用相同编译及长度限制流程。
- 模型接入按 Anthropic Messages、OpenAI Chat Completions 和 OpenAI Responses 分别转换请求与事件，共用 HTTP 传输和错误处理。
- 数据库通过应用工厂传入，读取配置和导出接口说明不会打开数据库。SQLite 在数据库层限制同一会话只能有一条进行中的生成；不同会话可以分别生成。
- 前端树缓存统一处理服务端快照与流式内容，并按会话保存生成控制、分支请求顺序和错误。流式解析会报告无效数据及缺失终态。
- `npm run contract:generate` 依据后端 OpenAPI 更新前端接口类型；`npm run contract:check` 检查生成文件是否与当前接口一致。后端字段改变后需要重新生成并审查差异。
- 持续集成运行后端测试、接口类型检查、前端测试和构建；独立 Windows 检查验证启动器只停止自己记录的进程。也可以在仓库根目录执行 `./scripts/tests/runtime-processes.test.ps1`。

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
# 从本地或 SSH SillyTavern 目录导入

左侧的 **SillyTavern 导入** 支持 SSH 主机别名（例如 `oc`）、酒馆目录（例如 `~/SillyTavern`）和用户目录（默认 `default-user`）。SSH 使用运行后端的电脑上的 OpenSSH 配置和已有认证；远端只需要 Python 3，不需要运行 SillyTavern 服务。

点击“预览远端配置”后会显示可导入数量、已有数量、转换限制和未导入的目录。预览保留 15 分钟；“备份并导入”写入预览时读取的配置快照。默认只新增资源；勾选“启用远端当前提示词与新会话默认设置”会替换所有会话共用的提示词，并为新会话设置用户名、世界书和当前连接。已有会话的角色、世界书绑定和聊天记录不会修改。

也可在项目根目录使用命令行工具：

```powershell
# 只预览，不修改数据库
./scripts/import-sillytavern.ps1 -SshHost oc -Directory '~/SillyTavern'

# 备份后正式导入；同时启用当前提示词与新会话默认设置
./scripts/import-sillytavern.ps1 -SshHost oc -Directory '~/SillyTavern' -Apply -Activate

# 导入本地目录；用户目录可以是安装目录、data 目录或实际用户目录
./scripts/import-sillytavern.ps1 -SshHost '' -Directory 'D:/SillyTavern' -Apply
```

Python 入口为 `uv run --frozen --python 3.12 python scripts/import-sillytavern.py`，接受 `--ssh`、`--directory`、`--user`、`--apply`、`--activate`、`--report` 和用于隔离测试的 `--database-url`。默认数据库读取 `backend/.env` 中的 `TREECHAT_DATABASE_URL`；相对数据库路径按项目根目录解析，与启动脚本一致。数据库备份位于 `.yggdrasil-runtime/backups/`；使用 SQLite 在线备份，包含已经提交的 WAL 数据。默认只预览；预览不升级数据库。

可用资源包括 PNG/JSON 角色卡及头像、嵌入世界书、独立世界书、完整连接配置及其指定密钥、全部保存的密钥、Chat Completion 提示词顺序/开关/角色/文本、系统提示词模板、采样参数和用户角色。导入的提示词预设可在“全局 Prompt Profile”中选择、编辑和保存；保存的 API Key 可在导入面板应用到指定 API 配置，读取接口不会返回明文。

重复导入按源目录和源文件身份去重，不覆盖本地编辑；远端配置变化会明确报告。没有完整地址、模型或对应密钥的连接只保存原始配置。没有等价支持的消息深度/条件注入、世界书触发逻辑、正则作用范围不会被猜测或悄悄改变；受影响的条目禁用或仅保留原始数据，并显示限制。世界书递归扫描仍使用 Yggdrasil 的现有关键词扫描。TextGen/instruct/context/reasoning、主题、快捷回复和群聊设置等保存为可查看的原始配置，不代表对应功能已启用。

聊天记录、群聊记录、背景图、缓存、备份和插件代码不在本次配置导入范围；报告列出这些目录和文件数量。整个导入事务遇到错误时回滚，解析错误会阻止正式导入。工具不会向任何导入的 API 地址发送模型请求。
## OC 上共用公网端口的部署

当前访问地址为 `https://tavern.apeirianetwork.com:15266/`。`tavern.apeirianetwork.com` 的 CNAME 指向 `js1.blockelite.cn`，使用仅 DNS 模式。这个部署只使用 Cloudflare 的 DNS，不使用 Cloudflare 代理、Tunnel、Workers、账户 API 或证书服务。

公网 `15266` 沿用 OC 的内部 `8802` 入口。Caddy 在 `8802` 提供自签名 HTTPS，并按域名分发请求：`tavern.apeirianetwork.com` 提供 Yggdrasil 前端，`/api` 转给 `127.0.0.1:8811`；`js1.blockelite.cn` 转给原有 SillyTavern 的 `127.0.0.1:8815`。访问时由用户在浏览器手动接受自签名证书。两个域名的证书均由 OC 本机生成，不向外部证书机构发请求。

运行目录是 `/home/kmichiru/YggdrasilTavern`：`current` 指向当前代码版本，`releases` 保存代码版本，`shared/treechat.db` 和 `shared/backend.env` 保存数据库及现有登录设置。复制本地 SQLite 时使用在线备份；角色、世界书、API 配置、密钥和会话随一致的数据库快照一起复制。

后台运行由三个用户级 systemd 服务管理。`yggdrasil-tavern.service` 运行 Yggdrasil 后端；`yggdrasil-gateway.service` 运行 Caddy；`sillytavern-upstream.service` 运行原有 SillyTavern。配置定义在 `deploy/oc/`。SillyTavern 必须保留 `--listen true` 来启用原有密码验证，同时通过 `--listenAddressIPv4 127.0.0.1 --listenAddressIPv6 ::1` 将实际监听限制在本机。直接使用 `--listen false` 会使它跳过原有密码验证。

`scripts/package-oc-deployment.py` 打包当前工作目录的代码、构建文件、登录设置和数据库快照；私有部署包放在已被 Git 忽略的 `.yggdrasil-runtime/deploy-oc/`。`scripts/prepare-oc-deployment.py` 在 OC 校验文件哈希、创建 Python 环境并启动本机后端，拒绝覆盖已存在的共享数据。`scripts/activate-oc-gateway.py` 切换已有公网入口，并在检查失败时恢复原有 SillyTavern。初次准备成功后不应直接重复运行准备脚本覆盖数据；更新应保留 `shared` 数据并明确选择新的代码版本。
