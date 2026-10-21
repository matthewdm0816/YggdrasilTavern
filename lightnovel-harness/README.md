# lightnovel-harness

日式轻小说写作 harness：**先做设定集和大纲，再做分场景的细纲，最后按细纲一场一场地写正文**。写正文的那一次模型调用只看到一份纯自然语言的"场景说明"，看不到任何工具、JSON、流程信息或剧透。

## 三条核心设计

### 1. 写作那一刻的上下文是干净的

整个流程分成两个"平面"：

| | 控制平面（规划 / 校对） | 写作平面（写正文） |
|---|---|---|
| 角色 | `planner`、`analyst` | `writer` |
| 输入输出 | 结构化 JSON，用 pydantic 校验，再过确定性检查 | 纯文本进，纯正文出 |
| 能看到的 | 全部设定，包括秘密和未来剧情 | 只有"写手上下文"（见下） |

**写手上下文**（代码里叫 writer packet，由 [`packet.py`](src/lnharness/packet.py) 生成）是把 YAML 计划翻译成"编辑交给作家的场景说明"：

- **包含**：作品基调、世界常识、本场登场人物的口吻卡（一人称、口癖、示例台词、潜台词）、人物之间当前的称呼、已登场能力的限制与代价、到目前为止的故事（来自已写正文的摘要）、必须保持一致的事实、上一场结尾的原文、本场的目标/阻碍/结果/情绪变化/节拍、要不动声色写进去的细节。
- **不包含**：任何 id（`F1`、`hero`…）、JSON、工具、"节拍/伏笔"等流程词；角色的秘密；谜团真相（除非本场揭晓）；伏笔的真正含义（除非本场回收）；还没登场的能力；力量体系的内部规则；后续章节的任何内容。
- 写手调用是单轮的 system + user，没有工具定义，没有历史对话。
- 写之前会先跑确定性检查，细纲有错误就拒绝写作。

用 `lnh packet <卷> <章> <场>` 可以直接打印写手会看到的全部内容；每一次模型调用的完整输入输出都存在小说项目的 `logs/` 目录。

### 2. 先大纲、后细纲、再写字，而不是一直 continue

```
premise.md（企划书，你写）
  → bible.yaml（设定集）            lnh plan bible
  → plan/vol01.yaml（卷纲）         lnh plan volume 1       → lnh check / lnh review 1
  → plan/vol01/ch01.yaml（细纲）    lnh plan chapter 1 1    → lnh check
  → draft/vol01/ch01/s01.md（正文） lnh draft 1 1 1  或  lnh write 1 1
       ↳ 自动 lint（文风检查） + digest（校对提取，写入 state/ledger.yaml）
       ↳ 有问题时 lnh revise 1 1 1
  → 下一章的细纲以"实际写出来的内容"为准     lnh plan chapter 1 2
```

- 每一场正文都被节拍框住：写手被要求写完最后一个节拍就停笔，不许自行推进剧情。
- 写完后由快速模型对照细纲做校对：哪些节拍漏写了、哪些伏笔没埋进去、有没有节拍之外的重大事件（剧情漂移）、有没有 OOC。结果写进状态账本，`lnh check` 会把这些列成警告。
- 细纲是"写到哪章规划到哪章"：规划第 N 章时，模型看到的是前面章节**实际写出来**的摘要，而不是当初的计划。卷纲是锚，账本是现实。

### 3. 轻小说要素：在哪里规划、怎么检查

| 要素 | 在哪里规划 | 确定性检查（`lnh check`） |
|---|---|---|
| 伏笔与回收 | 卷纲 `foreshadows`：表面细节 / 真相 / 埋设章 / 二次提醒 / 回收章 / 隐蔽程度；细纲把它分配到具体场景 | 回收必须晚于埋设且至少隔 2 章；埋得深又没二次提醒会警告；卷纲安排的伏笔必须分配到场景；不能在没安排的章节回收；正文里没体现会警告 |
| 转折的惊喜感 | 卷纲 `twists`：转折内容 / 为什么必然 / 支撑它的伏笔 | 至少两条在转折之前埋下的线索；`lnh review` 让读者模型只看转折前的梗概去猜，再由编辑模型判断有没有被猜中并给替代方案 |
| 伏线（支线） | 卷纲 `threads`：类型、推进章节、收束章节 | 必须有主线；不能连续 4 章以上停滞；收束不能早于最后一次推进 |
| 配角 | 设定集里每个角色都有 want / need / 缺点 / 口吻 | 只出场一次、连续 4 章以上消失（被遗忘的配角）会警告；主角和女主角必须出场 |
| 战力不膨胀 | 设定集里每个能力写清效果 / 限制 / 代价；卷纲 `power_limits` 设本卷上限或封印 | 不能使用未登记的能力；被封印的能力不能用；持有者必须在场；新能力不能在高潮章或之后第一次登场（机械降神）；一卷新登场能力超过 2 个会警告；正文用了计划外的能力会警告 |
| 母题 | 设定集 `motifs`：意象 / 意义 / 意义如何变化；卷纲和细纲标出出现位置 | 一卷至少出现两次，并出现在高潮章或最终章 |
| 谜团 | 设定集 `mysteries`；卷纲标出本卷提出和解答的谜团；细纲用 `reveals` 标出哪一场让读者知道答案 | 本卷至少解答一个、提出一个；揭晓计划外的谜团会警告 |
| 能力保密 | 能力的 `concealed_until`（读者不知道它存在，直到某个谜团揭晓）和 `cost_concealed_until`（代价本身是谜） | 保密期间写手只看到"异常现象 + 限制"，看不到能力名、代价和本卷上限规则；引用不存在的谜团会报错 |
| 结构与节奏 | 卷纲起承转结、每章类型（日常/喜剧/恋爱/事件/悬疑/战斗）和紧张度、章末引子 | 高潮章在后 30% 且紧张度最高；不能连续三章同一类型或同一档紧张度；每章必须有引子 |
| 称呼 | 设定集 `address_book`；正文中称呼变化由校对提取 | 写手上下文永远使用最新称呼 |
| 角色口吻 | 一人称、说话方式、口癖、示例台词 | 示例台词少于两句会警告；校对会标出 OOC |
| 文风 / AI 腔 | 小说项目的 `style.md`（原样进入写手系统提示） | `lint`：套话、"仿佛/似乎"等词密度、对话比例、长段落、重复片段、正文混入写作说明、总结式结尾、字数偏差 |

## 安装

需要 [uv](https://docs.astral.sh/uv/)。

```bash
cd lightnovel-harness
uv sync
```

API Key 放在 `lightnovel-harness/.env`（已被 git 忽略，格式见 `.env.example`）：

```
OPENCODE_GO_API_KEY=...
```

## 模型分工

默认配置在每个小说项目的 `project.yaml` 里，可以随时改：

| 角色 | 默认模型 | 协议 | 用途 |
|---|---|---|---|
| `planner` | `gemini-4-argon-contributor` | Gemini 原生（`/inference/go/google/v1beta`） | 设定集、卷纲、细纲、卷纲审阅 |
| `writer` | `gemini-4-argon-contributor` | Gemini 原生 | 只写正文和改稿 |
| `analyst` | `deepseek-v4.1-flash` | OpenAI 兼容（`/inference/go/openai/v1`） | 写完后的校对提取、读者预测 |

每个项目有一个固定的 `session_id`，所有请求都带 `x-opencode-session` 头，方便 OpenCode 做缓存路由。

## 用法

```bash
uv run lnh init novels/my-novel --title "我的轻小说"
# 编辑 novels/my-novel/premise.md 和 style.md
uv run lnh -p novels/my-novel plan bible
uv run lnh -p novels/my-novel plan volume 1
uv run lnh -p novels/my-novel review 1          # 可选：读者预测 + 编辑意见，写到 plan/vol01.review.md
uv run lnh -p novels/my-novel plan volume 1 --feedback novels/my-novel/plan/vol01.review.md
uv run lnh -p novels/my-novel plan chapter 1 1
uv run lnh -p novels/my-novel check
uv run lnh -p novels/my-novel packet 1 1 1      # 看写手会看到什么（不调用模型）
uv run lnh -p novels/my-novel write 1 1         # 写完第 1 章所有场景
uv run lnh -p novels/my-novel revise 1 1 2 --notes "这一场的吐槽太多了"
```

- 所有 YAML 都可以手动改；改完跑 `lnh check`。
- `plan` 系列命令遇到已存在的文件会拒绝覆盖：`--feedback "意见或文件路径"` 是在原文件基础上修订，`--force` 是从头重写。
- `novels/` 目录默认被 git 忽略（手稿不进这个仓库）。

## 小说项目的文件结构

```
novels/<名字>/
  project.yaml          模型与目标字数配置
  premise.md            企划书（你写）
  style.md              文风指南（你写，原样交给写手）
  bible.yaml            设定集
  plan/vol01.yaml       卷纲
  plan/vol01.review.md  卷纲审阅意见
  plan/vol01/ch01.yaml  细纲
  draft/vol01/ch01/s01.md   场景正文（改稿前的版本存为 s01.prev.md）
  draft/vol01/ch01.md       合并后的整章
  state/ledger.yaml     状态账本：每场的摘要、新事实、称呼变化、角色得知的信息、伏笔落地情况
  logs/                 每一次模型调用的完整输入输出
```

## 代码结构

| 文件 | 作用 |
|---|---|
| [`schema.py`](src/lnharness/schema.py) | 所有计划和账本的数据结构（字段说明同时是给规划模型的指示） |
| [`packet.py`](src/lnharness/packet.py) | 写手上下文编译器 |
| [`checks.py`](src/lnharness/checks.py) | 确定性检查 |
| [`lint.py`](src/lnharness/lint.py) | 正文文风检查 |
| [`stages.py`](src/lnharness/stages.py) | 各阶段：规划、写作、校对、改稿、审阅 |
| [`llm.py`](src/lnharness/llm.py) | 两种协议的模型调用、JSON 校验与修复重试、调用日志 |
| [`prompts/`](src/lnharness/prompts) | 各阶段提示词 |
| [`templates/project/`](src/lnharness/templates/project) | `lnh init` 复制的项目模板 |

测试：`uv run pytest`（不调用真实模型）。

## 已知问题

- 校对（`digest`）由快速模型判断"剧情漂移"和"漏写节拍"，可能误报。`lnh revise` 会把这些判断连同 lint 结果一起当作修改意见交给写手，所以改稿前最好先看一眼 `lnh check` 的输出；不认同时用 `--notes` 写自己的意见，或者直接重新 `lnh digest`。
- 规划模型写的文字（伏笔的表面细节、能力限制等）会原样进入写手上下文，里面如果自带剧透，代码拦不住；`lnh packet` 用来人工检查。

## 还没有做的

- 恋爱进度阶梯（好感度每一级需要什么事件支撑）只写在提示词里，没有结构化字段和检查。
- 插图场面（挿絵）规划、卷末后记。
- 跨卷检查：目前每卷单独检查，前一卷留下的伏笔只会在规划下一卷时提示给规划模型。
- 重写某一场之后，后续场景的摘要不会自动失效，需要手动重新 `digest`。
