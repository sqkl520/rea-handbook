<div align="center">

# REA Handbook

> *「这不是 REA 的说明书，是一份踩坑记录。」*

[![License: MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)
[![Unofficial handbook](https://img.shields.io/badge/REA-Unofficial%20handbook-d73a49?style=flat-square)](NOTICE.md)
[![Based on REA 6.5.0](https://img.shields.io/badge/based%20on-REA%206.5.0-blue?style=flat-square)](https://www.npmjs.com/package/rea-agents)

**给第一次用 REA 的人：一本把坑写清楚、每个数都标了出处的第三方手册。**

<sub>非官方第三方手册 · 基于 REA 6.5.0 写出 · 三平台覆盖不均（详见「这本手册会过期」）</sub>

REA 是一个本地跑的逆向工程工具：一个 CLI 加一个 MCP server，把“读二进制、读打包产物”
变成结构化证据喂给 AI agent。它不执行目标程序，静态读完，给你一张带出处的图。

这是它读一个 Electron 应用主程序的真实输出（231 MB 的 `OpenCode.exe`，9 个安全开关，一次调用；本机实测 7–9 秒）。看 `fuses[9]` 那几行：`raw_byte` 49 表示开、48 表示关；`complete: true` 表示一次读完，不用二次调用。

```text
$ rea inspect-electron-fuses OpenCode.exe
operation: inspect_electron_fuses
normalized_result:
  artifact: { sha256: b82ea814…, bytes: 231548456, format: pe }
  slices[1].sentinels[1].fuses[9]{index,name,state,raw_byte}:
    0,RunAsNode,enabled,49
    1,EnableCookieEncryption,disabled,48
    2,EnableNodeOptionsEnvironmentVariable,enabled,49
    3,EnableNodeCliInspectArguments,enabled,49
    4,EnableEmbeddedAsarIntegrityValidation,disabled,48
    5,OnlyLoadAppFromAsar,disabled,48
    6,LoadBrowserProcessSpecificV8Snapshot,disabled,48
    7,GrantFileProtocolExtraPrivileges,enabled,49
    8,WasmTrapHandlers,enabled,49
  complete: true
```

官方文档按功能组织，不按“第一次会卡在哪”组织。

567 MB 的归档跑完，产出 570 MB 的 evidence。照官方追溯示例用 `readFileSync` 去读它，
直接崩：

```text
Error: Cannot create a string longer than 0x1fffffe8 characters
```

官方材料里同时放着对的做法（`jq -c` 流式投影）和会崩的做法，但两个示例都没标各自适用的体量，多大的 evidence 该走哪条要自己拼。
本手册补的就是这些：14 种症状、11 类目标、21 处【实测】标注，每个结构数旁边都留了能跑出它的命令。

有两件事别混：**读这本手册**只要 Git，**跑手册里的命令**才要装 REA。

```bash
git clone https://github.com/sqkl520/rea-handbook.git    # 读这本手册（本仓库）
npx rea-agents setup                                     # 跑通手册里的命令（装的是 REA，不是本仓库）
```

[看效果](#凭什么信效果与机制每条断言旁边就是复算命令) · [装上就能用](#装上就能用) · [机制](#五条撞得到的上限) · [你带着什么问题来](#你带着什么问题来就翻哪一篇) · [局限](#这本手册会过期也有些事它做不到)

</div>

---

> [!IMPORTANT]
> **非官方声明**：本仓库是 [REA](https://github.com/morluto/rea)（morluto，MIT 许可）的**第三方学习记录**，
> 与 REA 项目**无隶属、背书或赞助关系**。**REA 是 morluto 的 MIT 项目：<https://github.com/morluto/rea>。**
> 本仓库中的教程、提示词与脚本为原创内容；对 REA 的使用遵循其 MIT 许可。

## 装上就能用

读手册的三条路先列在这，装 REA 的两条在后面。

**读手册**（三选一）

| 方式 | 做法 | 需要什么 |
| --- | --- | --- |
| 克隆 | `git clone https://github.com/sqkl520/rea-handbook.git` | 只要 Git |
| 直接看 | 在 GitHub 上翻 `docs/` `guides/` `case-studies/` | 只要浏览器 |
| 只用脚本 | `node tools/asar-peek.cjs <app.asar> package.json` | Node.js，无安装步骤 |

**跑手册里的命令**（三选一）

```bash
npx rea-agents setup              # 交互式：把 REA 注册到你的 AI agent（Claude Code / Codex / Cursor 等）
npm install --global rea-agents   # 或：只装命令行，得到 rea 命令
npx -y rea-agents <命令>          # 或：不装，每次一次性运行
```

装完先跑 `rea doctor`，确认本机哪些能力可用。`healthy: false` 很常见，原因和怎么判断见下文「手册里几个最有价值的发现」的最后一条。`node verify-handbook.mjs` 是另一回事——它查的是这份手册本身有没有坏，不是查你的安装。

前置是 Node.js 22.19+ / 24.11+ / 26+（不支持 23、25 及 prerelease），这是 REA 的 `package.json` 里 `engines` 字段原文：`^22.19.0 || ^24.11.0 || >=26.0.0`。大部分能力零依赖：静态分析 JavaScript/Electron、Go/Rust 二进制、.NET 程序集、PE 资源、Electron fuses 等，只要 Node.js；需要 Ghidra/Hopper/IDA 的只有原生二进制反编译一类。SQLite 另有更严的门槛，见下文「手册里几个最有价值的发现」。

然后在 agent 里直接说话：

```text
分析 /path/to/electron-app.asar，先给我图谱再给 IPC 通道表
这个 .exe 的类型清单全量提取失败了，按 64 MiB 预算的出路重写命令
把 case-studies/opencode.md 的追踪方法用到我手上的归档上
```

## 你带着什么问题来，就翻哪一篇

| 你的处境 | 翻哪一篇 | 可复算的规模 |
| --- | --- | --- |
| 第一次装，不知道先跑哪条命令 | [docs/01-getting-started.md §1](docs/01-getting-started.md#1-rea-是什么) | `wc -l < docs/01-getting-started.md` → 719 |
| 要把 REA 接进你的 AI agent | [docs/02-agent-integration.md §一条命令](docs/02-agent-integration.md#一条命令搞定推荐) | — |
| 手上有个目标，不知道该用哪个命令 | [guides/by-target-type.md §速查表](guides/by-target-type.md#目标类型速查) | 11 类目标，其中 6 类零依赖 |
| 命令报错了，或结果看不懂 | [guides/troubleshooting.md §症状](guides/troubleshooting.md#症状error-cannot-create-a-string-longer-than-0x1fffffe8-characters) | 14 种症状，675 行 |
| 想看真实产出长什么样 | [case-studies/README.md §案例一](case-studies/README.md#案例一pcl2--从-il-里读出一个启动器的完整架构) | 3 个案例，5.5 / 146 / 567 MB |
| 想让 AI 替你做分析 | [prompts/README.md §怎么用](prompts/README.md#怎么用) | 2 份模板 |
| REA 覆盖不到的角度，要自己写解析 | [tools/README.md §脚本清单](tools/README.md#脚本清单) | 14 个脚本，1,146 行 |

一句话分工：README 只管“凭什么信”和“从哪进”，具体内容由各目录自己的 README 承担，两边不重复写。

表里那几个规模数全都能当场数出来：

```bash
grep -E '^\| [0-9]+ \|' guides/by-target-type.md | wc -l          # → 11 类目标
grep -E '^\| [0-9]+ \|' guides/by-target-type.md | grep -c 零依赖  # → 其中 6 类
wc -l < guides/troubleshooting.md                                  # → 675 行
git ls-files 'tools/*.cjs' | xargs wc -l | tail -1                  # → 1146 行 / 14 个脚本
```

（`11 类`用速查表行数计）

## 凭什么信：效果与机制，每条断言旁边就是复算命令

手册的机制是两条东西：一套三级事实标签，五道会撞到的上限。分级制度让读者能区分“官方写的”和“我们测出来的”：

| 标签 | 含义 | `guides/by-target-type.md` 里的数量 |
| --- | --- | --- |
| 【官方】 | 官方文档与契约写明的 | 8 处 |
| 【实测】 | 我们在真实目标上跑出来的 | 21 处 |
| 【我们的发现】 | 官方未展开、或表述分散在各篇的 | 1 处 |

```bash
# 排除文件头的图例行（第 7 行同时定义了【实测】和【官方】），只数正文里的实例
grep '【官方】' guides/by-target-type.md | grep -vc '标注约定'      # → 8
grep '【实测】' guides/by-target-type.md | grep -vc '标注约定'      # → 21
grep -c "【我们的发现】" guides/by-target-type.md                   # → 1
```

**不数图例，是这类计数最容易错的地方**：直接 `grep -c` 会把定义行也算成一次使用。

关于“【我们的发现】”这一档：初稿标了 3 条，逐条对照 REA 6.5.0 官方 docs 后**撤掉 2 条**。“512 MiB 墙”和“`capabilities` 不完整”官方都写过：前者叫 "Node's single-string limit"，后者在 `docs/cli.md` 里明确指向 server tool list。剩下的这 1 条是：官方给了 `--type` 这条出路，但没说全量失败时你拿不到类型清单，而拿不到清单就填不出 `--type`。

**“复算”这个词要说清楚指的是什么**：正文里每个**结构数**（文件数、行数、标注数、症状条数）旁边都有能跑出它的命令；**实测数**（节点数、边数、字节数）来自分析当时的原始输出——其中案例三的那些，原始摘要就在仓库里（[`case-studies/evidence/`](case-studies/evidence/BASELINE.md)，4.8 KB），你可以直接读出来核对。完整图谱（354 MB）不在仓库里，想复现得拿同样的目标重跑。给不出命令的结构数我们不写；实测数一律标出它出自哪一行。

### 三条断言

**一、官方示例里那条会崩的路** `guides/troubleshooting.md` 第一种症状的报错原文：

```text
Error: Cannot create a string longer than 0x1fffffe8 characters
code: 'ERR_STRING_TOO_LONG'
```

146 MB 的 asar 产出 354 MB evidence（能读通），567 MB 的 asar 产出 570,218,269 字节——这份用 `readFileSync` 整份读入必定崩，因为它超了 V8 单个字符串的上限。同一套脚本换个目标就崩，最容易被当成偶发。

```bash
grep -c '^## 症状' guides/troubleshooting.md    # → 14 种症状条目
```

**二、跑一次能产出多少数字** OpenCode 桌面版 146 MB 的 `app.asar`，【实测】计数（`guides/by-target-type.md` 第 107 行）：

```
图谱 27,278 个节点 / 32,977 条边 / 7,823 条终端路径
AST 节点 4,751,494 个 / findings 30,648 条 / 解析 JS 4,489 个
IPC：163 个操作 / 76 个字面量通道 / 81 个主进程 handler / 55 组配对
```

```bash
grep -n "27,278" guides/by-target-type.md       # → 第 107 行，整串计数都在这一行
```

**三、分析出来的不是“概要”，是能直接用的结构** PCL2 的崩溃诊断子系统，反编译出 46 个崩溃原因枚举——逐个从 `CrashReason` 常量读出来，不是猜的：

```
0  Java虚拟机参数有误          18 确定Mod导致游戏崩溃        36 Fabric报错并给出解决方案
1  Mod文件被解压              19 怀疑Mod导致游戏崩溃        37 Forge报错
2  MixinBootstrap缺失         20 Mod配置文件导致游戏崩溃     38 低版本Forge与高版本Java不兼容
3  内存不足                   21 ModMixin失败              39 版本Json中存在多个Forge
4  使用JDK                    22 Mod加载器报错             40 Mod过多导致超出ID限制
…
```

顺带发现一条：**#35「Fabric报错」在代码里没有生产者**。模板存在，但 `AnalyzeCrit1/2/3` 都不产生它——`AppendReason` 覆盖了其余几十个枚举值，唯独跳过这一个（以 2026-10 的公开源码为准）。这类“文档里有、代码里没有”的坑，是读反编译源码才看得到的。

```bash
wc -l < case-studies/pcl2.md                          # → 3639 行，单份主报告
grep -n "枚举全表" case-studies/pcl2.md                 # → 第 1959 行，46 行完整枚举表
```

三个案例的规模跨两个数量级：5.5 MB 的单文件 .NET 应用、146 MB 的 Electron 归档、567 MB 的巨型归档。最后一份只完成了一部分：分析到 3,757 / 16,197 个源文件时父进程结果容量耗尽，报告原样写了“部分完成 + 容量耗尽”，不假装成功。

### 五条撞得到的上限

这一列记的是“官方写给谁看、以及写得有多分散”：

| 上限 | 数值 | 什么时候撞上 | 官方怎么说的 |
| --- | --- | --- | --- |
| V8 单字符串硬墙 | `0x1fffffe8` = 512 MiB | `readFileSync` 读几百 MB 的 evidence | 提了 "Node's single-string limit"（3 篇 docs），不给字节数，也没说自己的追溯示例正好会撞上 |
| .NET 表示预算 | 64 MiB（`67108864`） | `inspect-managed-members` 全量提取 | 写了预算、也给了 `--type` 出路，但没说全量失败时你拿不到类型清单（而拿不到清单就填不出 `--type`） |
| semantic 层节点上限 | 默认 100,000，可调到 1,000,000 | 大图谱的 semantic 层，`status: partial` | 写了默认值与 `--max-semantic-nodes` 的调节范围（1–1,000,000）。但**这是可调默认值，不是硬墙** |
| 父进程结果容量 | 视目标而定 | 567 MB 归档停在 3,757 / 16,197 个源文件 | 写了资源耗尽时不终止进程、已完成事实保留、`partial coverage`；但没给“这个体量大概停在哪”的量级预期 |
| 退出码语义 | 0 | 64 MiB 预算失败时退出码仍是 0，`coverage.status = "unavailable"` | 有退出码表，也提过 "result may include partial evidence"。但两句话隔着好几页 |

64 MiB 那条值得单说：文件只有 5.5 MB，全量成员提取照样失败。`coverage.status = "unavailable"`，`detail` 里写着超出 `67108864` 字节。这 64 MiB 不是文件大小上限，是一条独立的表示预算。反向反例也测过：3.4 MB 的 `System.dll`（`Microsoft.NET/Framework64/v4.0.30319`，sha256 `4ad37405…`）同样撑爆它。

复算：`grep -n "67108864" guides/by-target-type.md` → 第 146 行；`grep -n "67108864" guides/troubleshooting.md` → 112 与 120 行。

表里剩下三个数同样在仓库内可点：

```bash
grep -n "100,000 节点" case-studies/README.md        # → 33 与 212 行（semantic 上限）
grep -n "3,757" case-studies/README.md                # → 139 行（567 MB 停在哪）
grep -n "570,218,269" guides/troubleshooting.md       # → 46 行（整份读入必崩的那个体量）
```

（5.5 MB 那份是 PCL2 的数字，锁在它的某个版本上；它自带更新机制，你复跑时类型数、方法数对不上是正常的，`case-studies/pcl2.md` 开头的“可复现性说明”讲的就是这件事。）


## 手册里几个最有价值的发现

- **SQLite 的 Node 版本有独立的更严门槛**。整体支持 22.19+、24.11+ 与 26+，SQLite 另需 **24.15+**（要原生 `DatabaseSync.limits`）。于是 24.11–24.14 成了“满足整体、不满足 SQLite”的陷阱区间：SQLite 能力会报 `available: false`（`unsupported_version`），不细看结果就会漏掉。
- **`--filter-output` 写错时多数静默返回空**（字段名笔误、路径不存在），但未闭合的 `[` 切片例外：会报 `INVALID_OUTPUT_FILTER`（未闭合的 `]` 仍静默）。
- **`trace-application-feature` 的 seed kind：拿不准就用 `string`**。官方把 `channel` 列为合法取值。它并非不能用：源码里 `channel` 会在 `kind === "ipc-channel"` 的节点上匹配 `.label` / `.channel` / `.key`；但实际图谱里通道名常挂在 `javascript-asset` 节点的 `static_analysis.electron.ipc[].channel` 下，那时 `channel` 搜不到，`string` 能。实测 `kill-sidecar`：`channel` 返回 no-match，`string` 命中 2 个。
- **大 evidence 有 512 MiB 的 Node 硬墙**。V8 单个字符串长度上限约 512 MiB，超限即 `ERR_STRING_TOO_LONG`。几百 MB 的 evidence 投影要用 `jq` 流式处理，`fs.readFileSync` 整份读入会直接崩。
- **`rea capabilities` 不是完整能力清单**。它只覆盖按 provider 建模的操作；静态 JS/Electron、Go/Rust、PE 资源、Electron fuses 这些不在输出里。“没列”不等于“不能用”。

第 2、4、5 条在仓库内有原句可点，三条命令定位到行：

```bash
grep -n "INVALID_OUTPUT_FILTER" guides/troubleshooting.md
grep -n "0x1fffffe8" guides/troubleshooting.md
grep -rn "不是完整能力清单" docs/ guides/
```

第 1、3 条要真复现得装 REA 并备齐条件（Node 24.11–24.14 / 一个带通道的 Electron 归档），仓库内的引用位置是 `docs/01-getting-started.md` §2.2 与 `guides/troubleshooting.md` §trace no-match。

顺带一条最容易误判的：装完跑 `rea doctor`，`healthy: false` 很常见——只要本机没有任何一个分析引擎可用（Ghidra/Hopper 都没配），总分就是 false，哪怕零依赖功能全部能用。未配置的 provider 本身不扣分。判断能不能干活，看具体哪一项失败，别看那个总布尔值（详见 `docs/01-getting-started.md` §4.2）。

## 本手册和官方文档的关系

**官方文档是权威**：[morluto/rea](https://github.com/morluto/rea) 的 `docs/` 与官网 [rea.tools](https://rea.tools/)。

| | **本手册** | 官方文档 | `rea doctor` / `rea capabilities` |
| --- | --- | --- | --- |
| 回答什么问题 | 第一次会卡在哪、实际什么行为 | 有什么命令、契约是什么 | 我这台机器现在什么状态 |
| 粒度 | 场景与症状 | 工具与参数 | 单项能力 |
| 更新速度 | 慢，随版本漂移 | 跟版本走 | 实时 |
| 冲突时谁权威 | **以官方为准** | 权威 | 权威（本机） |

官方文档在“命令与契约”这件事上做得比谁都全，本手册不打算重复它；“第一次用从哪开始”本来就不是参考手册的义务，是分工不同，不是遗漏。

复算基线（三个数都印在各篇开头的注释块里，克隆后可查）：

```bash
grep -rn "最后核对日期" docs/ guides/              # → 3 处，全是 2026-10-18
grep -rn "6\.5\.0" docs/ guides/ | grep -c 版本     # → 6 处版本锚点
```

若与官方文档冲突，**以官方为准**。本手册基于 REA 6.5.0 写出，行为可能随版本变化。

## 两个被推翻的判断

写手册过程中被现实纠正的两次，都留在仓库里，没有藏起来。

**一、案例数字被目标自己的更新机制改掉**。PCL2 报告的 SHA-256 锁的是分析时那份文件；写作期间它自己更新，类型数与字符串数随之变化。教训写成了通用提醒：分析任何自更新软件前先记录哈希。

**二、`--scope project` 与 `@latest` 这两条写法，在手册里被标成了“别用”**。`--scope project` 会往仓库里写可提交的 `.mcp.json`；`@latest` 做持久注册违反官方那条“持久注册要用确切版本”的要求，行为和你的环境会随上游发布静默漂移。这两条官方都写了。`docs/installation.md` 同一段里接着说：`--scope local` 的注册不会被 `rea doctor` / `rea uninstall` 报告或移除，要 `claude mcp remove --scope local rea` 手动清理。本手册的价值是把它们放到“你先会踩到”的位置，而不是埋在安装文档第三页（见 `docs/01-getting-started.md` §3.5 与 §7、`docs/02-agent-integration.md`）。

## 仓库结构

```text
rea-handbook/
├── README.md                        # 你正在读的这份：凭什么信 + 从哪进
├── LICENSE / NOTICE.md              # MIT 全文（纯模板）／归属、商标、第三方工具清单
├── verify-handbook.mjs              # 链接 + 合规 + 占位符 + 结构 + 行号断言 + 证据核对 + 锚点核对 + 自述统计
├── docs/                            # 3 个文件：入门、agent 接入、目录页
├── guides/                          # 3 个文件：11 类目标怎么做、14 种症状怎么救
├── case-studies/                    # 7 个文件：PCL2 / ChatGPT 桌面版 / OpenCode + 索引 + 证据
│   └── evidence/                    #   ★ 一手证据：2 份追踪摘要 + 读法说明
│                                    #     案例里的数字可以直接从这里读出来核对
├── prompts/                         # 3 个文件：完整版与纯学习版提示词模板
└── tools/                           # 15 个文件：14 个分析脚本 + 清单
```

```bash
git ls-files | wc -l                              # → 37 个入库文件
git ls-files '*.md' | wc -l                       # → 17 篇 Markdown
git ls-files 'tools/*.cjs' | wc -l                # → 14 个脚本
```

四个正文目录各自的行数（`git ls-files 'docs/*.md' 'guides/*.md' 'case-studies/*.md' 'prompts/*.md' | xargs cat | wc -l`，`wc -l` 口径，不含本 README 与 `evidence/` 里的 JSON）。这些数字会随正文增删变化，上一条命令跑一次就是它们的当前值：

| 目录 | 文件数 | 行数 |
| --- | --- | --- |
| `docs/` | 3 | 1,043 |
| `guides/` | 3 | 1,303 |
| `case-studies/` | 5 | 4,541 |
| `prompts/` | 3 | 635 |
| 合计 | 14 | 7,522 |

这 14 个脚本只 `require` Node 内置模块，仓库里没有 `package.json`，也没有 `node_modules`。克隆后直接 `node tools/asar-peek.cjs <app.asar> package.json` 就能跑：

```bash
grep -rhoE "require\(['\"][^'\"]+['\"]\)" tools/*.cjs \
  | grep -vE "\('(node:)?(fs|path|crypto|buffer|util|zlib|os|assert)'\)" | wc -l    # → 0
```

发布相关的内部文件（发布清单等）不在仓库里，找不到不是丢了。

## 合规与数据流

- 本仓库的逆向分析报告基于**公开获取的软件发行包**，使用**静态分析方法**（不执行目标程序、不绕过任何技术保护措施），目的为学习软件设计思想。
- 分析对象包括 PCL2（源码公开，但采用自定义的分发许可，不是 OSI 开源）、ChatGPT 桌面版（闭源）与 OpenCode（开源）。所有商标与代码版权归各自权利人。报告中的代码片段为分析中整理/重写的示意，用于说明设计思想。
- 报告**不包含**：可用于规避授权/付费机制的操作细节、密钥或凭据、个人隐私信息。
- 如果你是本报告分析对象的作者，对内容有异议，请通过 [issue](https://github.com/sqkl520/rea-handbook/issues) 联系，我们会处理。

三个案例都是静态完成的：没有执行过目标程序的任何一行代码，没有绕过任何技术保护措施。分析对象是你本机已安装的软件。**请自行确认你的使用场景合法**，只在你对它有权做分析的目标上跑这些命令。

数据流一句话：分析全程在本机完成，目标文件和 evidence 都不上传；只有装 REA 那一步要联网。完整的归属与第三方工具清单见 [NOTICE.md](NOTICE.md)。

上面四条不是口头承诺，有一条命令能整仓扫一遍。词条在脚本里做了编码存储——这条命令本身不含任何敏感字面值：

```bash
node verify-handbook.mjs        # 【1】链接 【2】合规 【3】占位符 【4】结构 【5】篇幅 【6】行号断言 【7】证据 【8】锚点 【9】自述统计
```

它一次查这几项：相对链接是否都通、有没有敏感内容残留、有没有没填完的占位符、必需文件在不在位；正文里「某文件第 N 行」的说法是否还对得上（被引文件一改行号就漂，而你是按行号跳的）；案例数字与仓库里那两份证据是否一致；每个 `#锚点` 是否真的落在某个标题上（中文标题带全角标点时 GitHub 会把标点整个删掉，改一个字锚点就静默 404，而“链接全绿”仍然通过）；以及下面「仓库结构」里那些文件数和行数是否还对得上当前仓库（加文件时最容易忘的就是这张表）。

## 这本手册会过期，也有些事它做不到

- **会过期**。全部内容基于 REA 6.5.0，而 REA 更新很快。行为漂移是常态——现在复跑对不上，正常。
- **`rea capabilities` 的输出本身不完整**，本手册据它写的“哪些可用”也跟着不完整。
- **567 MB 那个案例只完成了一部分**。分析到 3,757 / 16,197 个源文件就停了；它证明的是“超大目标怎么降级处理”，不是“什么规模都能跑通”。
- **原生二进制反编译不在本手册范围内**。那条路要 Ghidra / Hopper / IDA，而且平台限制不少：Windows 上 Hopper 不可用、Ghidra 仅实验性支持、固件等类型多为 Linux-only。
- **`tools/` 的脚本不是产品**。都是“够用就好”的自写解析器，最长的一个 261 行（`wc -l tools/*.cjs | sort -n | tail -2` 的倒数第二行就是这个数），没有测试、没有参数校验，读得懂、可以改，但别当库用。
- **几百 MB 的 evidence 不是这些脚本处理的**，走 `jq` 流式投影。上面那条 512 MiB 的墙，是 Node/V8 的限制，不是 REA 的限制。
- **不涉及账号与捐赠回馈机制。** PCL2 那份报告里有一节标着“（略）”，内容是刻意移除的；本手册也**不承诺每个仓库外引用都能点开**，只承诺仓库内的相对链接由 `node verify-handbook.mjs` 全部验过。

这是一本会过期的手册，不是一份 API 参考。它的价值在“某个具体版本上、某个具体目标、我们真的撞到过”，而这三样都会在下一个版本失效。所以每条都配了复算命令，命令跑出来的数字比我们的结论更长久。

## 反馈与贡献

什么算 bug：你在 6.5.0（或你已逐条核对过的更新版本）上跑出与本手册不同的行为，且能给出命令与输出。什么算提案：缺的目标类型、缺的平台、缺的症状条目。

提之前请先跑这两条，它们能一次扫出死链、敏感残留和结构缺件：

```bash
node verify-handbook.mjs
git ls-files docs guides case-studies prompts | xargs cat | wc -l    # 正文体量基线
```

本手册的正文不接收外部提交的代码副本、密钥或可复现的攻击步骤。`node verify-handbook.mjs` 能拦下密钥与敏感字面值，其余靠人工。权利方对内容有异议，请走 [issue](https://github.com/sqkl520/rea-handbook/issues)。

## License

- **本仓库**（手册、提示词、脚本、案例研究）：[MIT](LICENSE) © REA Handbook contributors。
- **REA**：是 [morluto/rea](https://github.com/morluto/rea) 的 MIT 项目（Copyright (c) morluto）。本手册引用其公开文档与行为描述，遵循其 MIT 许可。

MIT：随便用，随便改。本仓库的 MIT 许可不涵盖任何商标的使用。

## 致谢

- [REA](https://github.com/morluto/rea) 与其作者 morluto：本手册讲解的工具。
- REA 官方文档与 [rea.tools](https://rea.tools/)：本手册的事实基线。
- 三个案例的分析对象 PCL2、ChatGPT 桌面版、OpenCode。

<div align="center">

**官方文档讲 REA 有什么命令。**<br>
**本手册讲第一次会在哪一步卡住。**

</div>