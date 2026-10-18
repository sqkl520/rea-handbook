<!--
  REA 入门指南（Getting Started）
  基于版本：REA 6.5.0（npm 包 `rea-agents`；bin 命令：`rea` / `rea-agents`）

  事实来源：
   - 官方文档（仓库 morluto/rea）：README.md、docs/installation.md、docs/cli.md、
     docs/sqlite-databases.md、docs/javascript-artifact-reconstruction.md、
     docs/binary-diagnostics.md、docs/process-capture.md 等
   - 实测记录：Windows 10 x64 + Node.js 24.14.0 + REA 6.5.0（2026-10-18 核对）。
     文中标注「实测」的行为来自本手册作者的验证；未标注的以官方文档为准。
   - 官方文档与本手册表述冲突时，以官方文档为准（官方仓库：github.com/morluto/rea）。

  最后核对日期：2026-10-18
-->

# 01 · 入门指南：安装、验证与第一次分析

面向第一次接触 REA 的人。本文假定你会使用命令行，但没听说过这个工具。

---

## 1. REA 是什么

**REA（Reverse Engineer Anything）** 是一套本地运行的逆向工程工具：一个 MCP server
加一个同名 CLI。它让你（或你的 AI agent）在不看源码的情况下理解一个软件——
去分析一个二进制、一个 Electron 应用、一个 .NET 程序集，然后回答"这个功能是怎么实现的"。

它解决的核心问题是：**把"读二进制/读打包产物"变成 agent 能消费的结构化证据**。
REA 返回的不只是反编译文本，还有模块关系、IPC 配对、构建元数据，以及每条结论背后的
**证据（Evidence）**和**诚实的未知项**——它不把"没找到"当成"不存在"。

三个关键设计：

- **本地分析**：目标不会被上传；分析在你自己的机器上完成。
- **静态优先**：大部分零依赖能力（第 5 节）只读文件、不执行目标。
- **两种用法同一套引擎**：agent 通过 MCP 调用；你在终端用 `rea <命令>` 调用同样的工作流。

> 本文只覆盖"装好并跑通第一次"。完整的命令清单见官方
> [tool catalog](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md#generated-catalog)；
> 本手册后续章节分别覆盖各能力域。

---

## 2. 前置要求

### 2.1 Node.js 版本（精确范围）

REA 6.5.0 要求的 Node.js 版本是 **精确的三段区间**（来自 `package.json` 的 `engines`）：

```text
^22.19.0 || ^24.11.0 || >=26.0.0
```

阅读方式：

| 你要的版本线 | 要求 | 例子 |
| --- | --- | --- |
| Node.js 22.x | `>= 22.19.0` | 22.19.0 ✅ / 22.18.0 ❌ |
| Node.js 24.x | `>= 24.11.0` | 24.11.0 ✅ / 24.10.0 ❌ |
| Node.js 26+ | 任意 26.x 及以上 | 26.0.0 ✅ |

**明确不支持**：Node.js 23、Node.js 25、以及所有 prerelease（含 nightly/canary）。
如果 `node --version` 落在这些版本上，先升级或改用受支持的版本线。

npm 是必需的（REA 使用与该 runtime 配对的 npm）。
REA **从不**擅自升级你的 Node.js、npm 或 Homebrew。

检查你的环境：

```bash
node --version   # 必须落在上面三段区间之一
npm --version
npx --version
```

### 2.2 SQLite 的额外门槛（务必读）

这是最容易踩的版本陷阱。**SQLite 分析有单独、更严格的 Node.js 要求**，
比 REA 整体的要求更严：

```text
SQLite 能力要求：Node.js 24.x >= 24.15，或 26+
```

于是出现一个**交叉区间**：

| Node.js 版本 | 满足 REA 整体要求？ | 满足 SQLite 要求？ |
| --- | --- | --- |
| 22.19.0 – 22.x | ✅ | ❌（SQLite 需要 24.15+/26+） |
| **24.11.0 – 24.14.x** | ✅ | ❌ **交叉区间——一切可用，唯独 SQLite 不可用** |
| 24.15.0 – 24.x | ✅ | ✅ |
| 26+ | ✅ | ✅ |

落在交叉区间时会发生什么（实测）：

- `rea capabilities` 里 `inspect_sqlite_database` 报 `available: false`、
  `availability_code: "unsupported_version"`；
- `rea inspect-sqlite-database <db>` 报 `capability_unavailable`，消息要求
  "Node.js 24.15 or newer … or a compatible Node.js 26+ runtime"；
- **其他一切功能照常工作**。

**建议**：新装机器直接用 Node.js 24.15+（或 26+）一次到位。如果你系统 Node
不能动（例如 24.14 是发行版自带），下载一份独立 Node 24.15+ 解压到任意目录，
用绝对路径调用（不动系统环境）：

```bash
# <解压的 node 目录> / <npm 全局目录> 换成你的实际路径（Windows 用 \node.exe）
"<解压的 node 目录>/node" "<npm 全局目录>/node_modules/rea-agents/scripts/rea.mjs" \
  inspect-sqlite-database <你的.db> --format json
```

### 2.3 三平台各自的额外依赖

除 Node.js 外，**三平台各有一样容易被忽略的系统依赖**：

| 平台 | 额外依赖 | 影响的工作流 | 缺失时的现象 |
| --- | --- | --- | --- |
| **Linux** | 一个 procps 兼容的 `ps` 在 REA 的 `PATH` 上 | Ghidra、JADX、固件工具、静态 JavaScript/Electron 分析（子进程属主检查） | 启动被拒绝（`capability_unavailable` / `provider_unavailable` / `execution_failure`） |
| **macOS** | Apple Swift 编译器（经 `xcrun`），即 Xcode Command Line Tools | 进程捕获、macOS 上受管 provider 进程监督 | 相关能力在 capability 检查中即不可用 |
| **Windows** | 无额外前置（除非你要配 Ghidra：需 Windows 10+ x64 与固定本地 NTFS 卷） | — | — |

Linux 修复：

```bash
# Debian/Ubuntu
sudo apt install procps
# Fedora/RHEL
sudo dnf install procps-ng
# Arch
sudo pacman -S procps-ng
```

macOS：装上 Xcode Command Line Tools 即可（`xcode-select --install`）。
REA **不会**替你安装 Xcode / Command Line Tools / 任何软件。

### 2.4 Bun（可选）

Bun 也可作为 runtime（`bunx rea-agents setup`）。两点注意：
`rea update` 在 Bun 下需要 **Bun 1.2.17+**（该版本才引入 `bun info`），
版本过旧时 `rea update` 会停下并让你手动升级 Bun；官方 CI **只测 Node.js**，
追求稳妥就用 Node.js。

---

## 3. 安装

三条路，按推荐顺序如下。每条命令都可以直接复制运行。

### 3.1 方式一：引导式 setup（推荐）

```bash
npx rea-agents setup
```

发生什么：

1. npm 会先请求下载包的批准（与 REA 的批准是**两个独立提示**）；
2. REA 列出检测到的受支持 agent，让你多选（已存在的 REA 注册默认勾选）；
3. 你**审查计划**——确切的配置路径、要写入的改动、要安装的 skill 目的地——
   然后批准。批准前 **不写任何文件**；
4. 完成后重启相应的 agent。

常用变体：

```bash
# 先看计划不落地（planned，退出码 0）
npx rea-agents setup --dry-run

# 只配置指定 agent（可重复 --client），跳过交互选择
npx rea-agents setup --client claude_code --client codex

# 只注册 MCP、不装 bundled skill
npx rea-agents setup --skill=false
```

行为要点（官方文档）：

- setup 默认同时安装配套的 **skill**（agent 工作流指令）；`--skill=false` 只留 MCP 注册。
- 隐式交互式 setup 要求 stdin、stdout、stderr **都是终端**；任一被重定向则保持非交互。
- 取消或拒绝任何一步都不会产生改动（退出码 0）；未经批准的 apply 报
  `needs_confirmation` 并退出 1。配置写入保留无关条目、做备份（`.rea.backup`）、原子替换。
- 用 Claude Desktop 的话：**先完全退出它**再批准，运行中的应用可能把注册覆盖掉。
- Windows 上 setup 会自动把持久注册包一层 `cmd.exe /d /c`（让 stdio 客户端
  能启动 npx shim），你不用管。

### 3.2 方式二：全局安装（得到 `rea` 命令）

```bash
npm install --global rea-agents
rea --help
```

装完后 `rea` 和 `rea-agents` 两个命令都可用（指向同一入口）。
然后可按需运行一次 `rea setup` 把 agent 注册配上。

注意：`npm install rea-agents`（不加 `--global`）只把可执行文件装进当前项目的
`node_modules/.bin`，**不会**让 `rea` 出现在 shell `PATH` 上。

### 3.3 方式三：免安装的一次性命令

机器上不想留任何安装时，用 npx 直接跑：

```bash
npx -y rea-agents@latest <命令>
```

完整例子（静态分析一个 Electron 应用，无需任何原生引擎）：

```bash
npx -y rea-agents@latest analyze-javascript-application <你的应用目录或 .asar> --json
```

Windows 上路径可以写成 `"D:/apps/example"` 这样的正斜杠形式。
代价：每次调用都会解析（必要时下载）包，比已安装的 `rea` 慢。

> `@latest` 适合**一次性命令**。持久注册的版本固定见下一节。

### 3.4 其他官方安装途径

| 途径 | 命令 |
| --- | --- |
| curl 包装脚本（只装全局 npm 包） | `curl -fsSL https://raw.githubusercontent.com/morluto/rea/main/install.sh \| bash`（支持 `--version <semver>`、`--dry-run`、`--no-setup`、`--no-prompt`、`--verbose`，经 `bash -s --` 传入） |
| 仅装 skill（不注册 MCP） | `npx skills add morluto/rea --skill reverse-engineer-anything` |
| Bun 等价入口 | `bunx rea-agents setup` / `bunx rea-agents@latest <命令>` |

### 3.5 版本固定：为什么不要用 `@latest` 做持久注册

对**持久存在的 MCP 注册**（写进 agent 配置、每次启动都跑一遍的那种），
官方要求使用**一个确切的包版本**（"Persistent registrations should use one exact
package version"）。原因：`@latest` 在每次客户端启动时都会解析"当时的最新版"，
行为和你的环境随上游发布**静默漂移**，升级无法审查、出问题也无法回溯版本。
`rea setup` 本身就遵守这个规则：它把你的注册固定为**执行 setup 的那个确切版本**。

固定方式有两种：

1. **让 setup 帮你固定**（推荐）：运行哪个版本的 setup，注册就固定到哪个版本。
   升级时重跑新版本的 setup 并审查计划：

   ```bash
   npx rea-agents@latest setup    # 查看并批准升级计划
   ```

2. **手动写注册**（例如手动配置 MCP 客户端时）：

   ```json
   {
     "mcpServers": {
       "rea": {
         "command": "npx",
         "args": ["-y", "rea-agents@6.5.0", "mcp"]
       }
     }
   }
   ```

   把 `6.5.0` 换成你想要的确切版本（Windows 上需自行包 `cmd.exe /d /c`；
   setup 会自动这么做）。需要**回滚**到旧版本时：

   ```bash
   npm exec --yes --package=rea-agents@2.4.0 -- rea setup
   ```

### 3.6 升级与卸载（概览）

```bash
rea update                 # 升级「拥有当前已装 CLI」的那份安装（npm 全局或 Bun 全局）
rea uninstall              # 卸载：只移除 REA 拥有的 agent 注册和 skill 文件
rea uninstall --purge-data # 额外清除 REA 的 cache/state（~/.rea 下）
```

`rea update` 只更新 npm/Bun 全局安装；npx 一次性用户的升级方式是重跑
`npx rea-agents@latest setup`。卸载保留 Hopper、Node.js、Evidence 文件、
无关 skill 与其他 MCP server。`rea uninstall` 不接受 `--client` 参数——它扫描全部。

---

## 4. 第一次运行

### 4.1 验证安装

```bash
rea --version    # 应打印 6.5.0（或你安装的版本）
rea --help       # 列出全部命令
```

### 4.2 `rea doctor`：它报告什么（以及 `healthy: false` 是正常的）

```bash
rea doctor
```

`rea doctor` 读取宿主机前置条件和 agent 配置，**只读、不做任何修改**。
不带选项时它审计：每一次检测到的 agent 注册、已安装的 skill、以及可选的原生分析引擎。

**关键认知**：官方原文是——its overall `healthy` value **can be false while your
chosen workflow works**。也就是说，一台没装任何原生引擎的干净机器上，
`rea doctor` 打印 `healthy: false` 是**预期现象**，不是安装失败。

实测输出（Windows 10 x64，无任何原生引擎，TOON 格式节选）：

```text
healthy: false
environment_healthy: false
scope:
  mode: audit-wide
  ...
scope_checks[14]:
  - name: node
    ok: true
    classification: healthy
    detail: 24.14.0
  - name: host
    ok: true
    classification: healthy
    detail: win32 x64
  - name: hopper
    ok: false
    classification: missing_analysis_engine
    remediation: "Run rea setup to install Hopper, or set HOPPER_LAUNCHER_PATH."
  - name: ghidra
    ok: false
    classification: missing_analysis_engine
    detail: GHIDRA_INSTALL_DIR is not set
    remediation: Set GHIDRA_INSTALL_DIR to an extracted Ghidra 12.1.x release directory.
  ...
```

怎么读：

- `scope_checks` 是检查清单；每项有 `classification`，常见值：
  `healthy`（通过）、`missing_analysis_engine`（可选引擎没装）、
  `config_drift`（agent 注册与当前版本不一致，重跑 setup 可修复）。
- **`node` 与 `host` 两项 `ok: true`，就说明 REA 本身能工作**。
  缺失的都是"可选的原生引擎"，只影响需要引擎的那部分能力。
- 有 scope 选项时，报告标注 `scope.mode: "explicit"`，`scope_checks`
  决定 `healthy` 与退出码；其余检查放在 `informational_checks`；
  `environment_healthy` 概括全局。

**按任务做定向检查**（比全量审计更有用）：

```bash
rea doctor --json                          # 完整 JSON 报告
rea doctor --target <你的目标路径> --json  # 附加一个目标检查
rea doctor --client codex --json           # 只要求某个 agent 注册就绪
rea doctor --provider ghidra --json        # 只要求某个原生引擎就绪
rea doctor --skill --json                  # 验证已安装的 skill 身份
```

两个实测确认的坑，不要踩：

- `doctor --provider` **只接受** `hopper`、`ghidra`、`ida`、`jadx` 四个 id。
  传别的（如 `pwntools-elf`）报 `VALIDATION_ERROR` 并列出合法值。
- `doctor` **不接受 `--dry-run`**——会报 `Unknown flag: --dry-run`。
  `--dry-run` 是 `setup` 的选项。

退出码：`doctor` 在其选定的检查范围内有必需检查失败时返回 **1**
（实测：没装任何原生引擎的机器上，`rea doctor` 与 `rea doctor --provider ghidra`
都返回 1——查询本身成功，1 只表示"该范围内有缺失"）。

### 4.3 Hello World：分析一个手边的二进制

不需要装任何引擎，拿系统里现成的可执行文件试第一课。
三平台各给一个必然存在的目标：

```bash
# Windows
rea inspect-artifact "C:/Windows/System32/where.exe" --format json

# macOS / Linux
rea inspect-artifact /bin/ls --format json
```

（Windows 上路径也可以写 `"C:\\Windows\\System32\\where.exe"` 转义反斜杠；
用 Git Bash 时引号里的反斜杠路径同样可用。）

成功时你得到的是一份完整 JSON 的 **Evidence 记录**。实测（where.exe）的关键字段：

```json
{
  "evidence_id": "ev_6b976ade...（64 位十六进制）",
  "subject": {
    "name": "where.exe",
    "digest": { "sha256": "a19f7b78..." },
    "local_path": "C:\\Windows\\System32\\where.exe",
    "format": "pe"
  },
  "operation": "inspect_artifact",
  "normalized_result": {
    "subject": { "root_format": "pe" },
    "coverage": { "status": "complete-within-substeps" },
    "observations": ["...root-manifest 观测..."],
    "next_probes": ["...建议的下一步操作，如 inspect-managed-artifact..."]
  }
}
```

几个值得注意的点：

- `subject.digest.sha256` 是**原文件的哈希**——所有分析都针对不可变快照，
  你的原文件不会被改动。
- `normalized_result.next_probes` 是 REA 根据目标类型**建议的下一步**
  （例如看到 PE 会建议 `inspect-managed-artifact` 检查托管元数据）。
- `coverage.status` 见第 6.5 节——它比退出码更能说明"结果完整度"。
- 这个命令能吃的目标很广：PE、ELF、Mach-O、目录、`.asar`、ZIP 包、
  APK/IPA/HAP 等。试一个普通文本文件会得到
  `target_unavailable / unsupported binary format`（退出码 1）——
  这是预期报错，不是装坏了。

进阶一点的 Hello World（Go 写的二进制，零依赖读取内嵌构建信息）：

```bash
# 任何 Go 编译的程序都行；例如 GitHub CLI、Docker、kubectl 等
rea inspect-go-binary "<你的 Go 二进制路径>" --format json
```

实测（`gh.exe`）会返回内嵌的 `go_version`（如 `go1.27.1`）、主模块与完整依赖清单
（含 `h1:` 校验和）。

### 4.4 可选：确认 MCP 服务端完整

```bash
rea mcp doctor
```

它启动一次生产 stdio 服务并自检。实测（节选）：

```text
healthy: true
adapter: production-stdio
server:
  name: rea
  version: 6.5.0
inventory:
  tools:
    expected: 207
    observed: 207
    missing: []
```

`healthy: true` 意味着 MCP 层（供 agent 调用的那 200+ 个工具）全部就位，
与你是否装了原生引擎无关。

---

## 5. 零依赖能力速览（REA 最有价值的部分）

只装 Node.js 和 npm，你就能用下面这一整排能力——它们不碰任何外部引擎：

| 能分析什么 | 返回什么 | 命令（CLI） |
| --- | --- | --- |
| JavaScript / Electron 应用（目录或 `.asar`） | 模块、imports、source maps、路由、IPC 配对、native add-on 关系 | `rea analyze-javascript-application <路径>`；通用路由 `rea analyze <路径>` |
| Go 二进制（ELF/PE/thin Mach-O） | 内嵌编译器版本、modules、replacements、build settings | `rea inspect-go-binary <路径>` |
| Rust 二进制 | cargo-auditable crate 名/版本/来源、依赖边 | `rea inspect-rust-binary <路径>` |
| .NET 程序集（PE/CLI） | 元数据、CIL 指令、声明的 native 依赖（P/Invoke） | `rea inspect-managed-artifact`、`inspect-managed-members`、`inspect-managed-native-boundaries` |
| PE 资源 | PE32/PE32+ 资源目录内容 | `rea inspect-pe-resources <路径>` |
| Electron fuses | 打包后的 fuse 字节状态 | `rea inspect-electron-fuses <路径>` |
| Flutter APK | Dart snapshot hash、每 ABI 库摘要、engine 构建 provenance | `rea identify-flutter-build <apk>` |
| HarmonyOS 包（`.hap`/`.hsp`/`.app`） | 包识别与组件 inventory | `rea inspect-artifact <包路径>` |
| 通用制品（ZIP/APK/IPA/asar/目录/PE/ELF/Mach-O…） | 清单、哈希、结构、下一步探针 | `rea inspect-artifact <路径>`、`rea extract-artifact <路径>` |
| Mach-O dylib 解析 | load commands + dyld 路径展开（纯 TypeScript，跨平台） | `rea trace-dylib-resolution` |
| 网站被动观察（CDP） | 页面结构、脚本、网络观察、请求的截图 | `rea list-browser-targets`、`inspect-web-page`、`analyze-web-bundle`（需 Chrome 系浏览器，自行启动带调试端口） |
| HAR / SAZ 网络捕获 | 请求、响应、暴露的载荷、来源位置 | `rea inspect-web-network-capture` |
| SQLite 快照 | 表、列、索引、视图、触发器、行样例 | `rea inspect-sqlite-database`（注意 Node 24.15+/26+ 门槛，见 2.2） |

### ⚠️ `rea capabilities` 不是完整能力清单

`rea capabilities` **只报告"按 provider 归组"的操作**——被建模为 provider 的能力
（包括两个内建静态 provider：`rea-artifact-graph`、`rea-dotnet-static`，以及
`native-macos`、`sqlite`、`ghidra`、`hopper`、`ida`）会出现在它的输出里。
而**没有 provider 归属的能力完全不出现**——即使它们完全可用。实测确认，
以下能力都不在 `rea capabilities` 的输出里：`analyze-javascript-application`、
`inspect-go-binary` / `inspect-rust-binary`、`inspect-electron-fuses` /
`identify-flutter-build`、网站观察系列、WASM、HarmonyOS……

**所以：不要拿 `capabilities` 当"我会不会这个"的判据。**
验证某个具体能力最直接的方式是跑那条命令，或查对应官方 guide。
（它对自己**已建模的 provider** 的状态报告仍然有用，比如会如实告诉你
SQLite 因 Node 版本门槛报 `unsupported_version`。）

### 需要原生引擎的部分（本节仅作预告）

原生二进制的深度分析（伪代码、函数 dossier、xrefs 等）需要
**Hopper、Ghidra 或 IDA** 之一；平台限制：
Windows 上 Hopper 不可用、Ghidra 仅实验性只读 P0（Windows 10+ x64、
固定本地 NTFS 卷、仅 x86/x86-64 PE）；macOS 与 Linux 支持最全。
详见手册后续章节与官方 `docs/installation.md`。

---

## 6. 输出怎么看

这一节是新手最容易困惑的部分，请完整读一遍。

### 6.1 默认格式是 TOON，不是 JSON

REA 的默认终端输出格式是 **TOON**（Token-Oriented Object Notation，来自
`@toon-format/toon` 库；一种缩进式的紧凑结构化文本，形似 YAML）。
它**不是** JSON——第一次看到时不要以为输出坏了。默认输出长这样：

```text
evidence_id: ev_6b976ade2bb884f9c142059f9a43f7b04fb0dbad53720eb4308b5e36c902fdc2
subject:
  name: where.exe
  digest:
    sha256: a19f7b783bc5611095d577f5eccc12069ca2b5e92bbe37f415429bb72c09792c
  local_path: "C:\\Windows\\System32\\where.exe"
  format: pe
...
```

适合人眼快速扫读。**要喂给程序（jq、脚本、JSON 消费者）时，加 `--json`。**

### 6.2 `--json` 与 `--format`

| 选项 | 作用 |
| --- | --- |
| `--json` | `--format json` 的快捷方式 |
| `--format <toon\|json\|yaml\|md\|jsonl>` | 显式选择格式（默认 `toon`） |
| `--full-output` | 在报告中包含完整诊断 |
| `--schema` | 打印该命令的输入 JSON Schema |
| `--llms` / `--llms-full` | 打印面向 LLM 的可读清单 |

一个容易困惑的细节：**`--json` 在终端上会缩进；被管道/重定向时变成紧凑单行**
（这是有意为之——给 agent/脚本省体积）。想要缩进的 JSON 文件就：

```bash
rea inspect-artifact "<路径>" --json | jq . > inspection.json
```

### 6.3 `--filter-output`：字段裁剪与两个陷阱

对大型结果，在**生成侧**裁剪比事后处理更省内存。语法是逗号分隔的**字段路径**
（不是 JSONPath），支持数组切片 `a[0,3]`：

```bash
rea inspect-pe-resources "<路径>" --format json \
  --filter-output evidence_id,normalized_result.artifact
```

实测输出：

```json
{"evidence_id":"ev_6b976a...","normalized_result":{"artifact":{"path":"...","sha256":"...","bytes":43008}}}
```

两个**实测确认**的陷阱（官方文档未提示）：

1. **字段名写错不会报错，静默返回空**。
   - 整个路径不存在 → JSON 下得到 `{}`（TOON 下输出为空，0 字节），退出码 0；
   - 外层键存在、叶子字段不存在 → 保留外层键填空对象，
     例如 `--filter-output normalized_result.statistics` 得到
     `{"normalized_result":{}}`——**看起来像"真的没有统计数据"，实际是字段名写错了**。
   - 后果：你无法靠"报错"发现字段名笔误。
     **字段名必须从一次不带过滤的完整输出里抄。**
2. **语法错误会报错**：未闭合的 `[` 切片报
   `INVALID_OUTPUT_FILTER`（"The --filter-output expression has a slice without
   a closing ]"），退出码 1。

### 6.4 Token 窗口：`--token-limit` / `--token-offset` / `--token-count`

```bash
# 输出前 40 个 token
rea inspect-artifact "<路径>" --token-limit 40

# 输出 token 数量（替代正常输出）
rea inspect-artifact "<路径>" --token-count
```

- 截断时末行会给出明确标记（实测）：
  `[truncated: showing tokens 0–40 of 1571]`。
- **硬约束（实测确认）**：`--token-limit` / `--token-offset`
  **不能**与 `--format json` / `jsonl` / `yaml` 同用——报
  `UNSUPPORTED_OUTPUT_COMBINATION`：
  "Token windows cannot preserve structured output. Remove
  --token-limit/--token-offset and use --filter-output or command pagination."
  退出码 1。想在结构化输出上省 token，用 `--filter-output`。

### 6.5 退出码：`0` 不代表完全成功

| 退出码 | 含义 |
| --- | --- |
| `0` | 操作**完成**了。结果**可能**包含 partial evidence、警告或未解决问题 |
| `1` | 操作**无法完成**（无效输入、权限、取消、超时或其他失败） |
| `128 + N` | 信号 `N` 结束了进程 |

所以**成功要以两个信号交叉判断**：退出码看"命令跑没跑完"，
`coverage.status`（在结果里）看"结果完整不完整"。

常见 `coverage.status` 取值：

- JS/Electron 应用分析：`complete` / `partial` / `unknown` / `unavailable`；
- artifact 检查（`inspect-artifact`）：`complete-within-substeps` / `partial` / `truncated`。

看到 `partial` 不是"坏了"——REA 会把**哪些没做完、为什么**写进结果
（`limitations`、`unknown_facts` 等字段），这正是它的设计。

其他已知的退出码语义（官方）：
- `setup --dry-run` 返回 `planned` 并退出 **0**；**取消 setup 也退出 0**
  （取消 ≠ 失败）；未经批准的 apply 报 `needs_confirmation` 退出 **1**。
- `doctor` 在选定检查范围内有必需失败时退出 **1**（见 4.2）。

### 6.6 stdout 与 stderr 的分工

- **stdout**：选定结果文档（"Stdout remains the selected result document"）。
  实测：**结构化错误文档也走 stdout**——包括 `rea inspect-artifact <不存在的路径>`
  这类失败的 `error:` 文档。所以 `rea ... --json > out.json` 拿到的文件
  要么是结果、要么是错误文档，两者都是 JSON、都可解析。
- **stderr**：交互提示 UI 与进度。
  静态 JS 分析会在 stderr 上输出 **`rea_progress` JSON lines**。
- 因此 `rea ... > result.json` 是安全的：进度不会污染结果文件。

两个开关：`NO_COLOR=1` 禁用颜色；`--accessible` 用顺序式 yes/no 提示。

### 6.7 脚本里的建议写法

```bash
set -o pipefail   # 让下游 formatter 保留 REA 的失败状态
rea inspect-artifact ./app.asar --json | jq . > inspection.json
```

`pipefail` 是 bash/zsh 等 shell 的能力（Windows cmd 无等价物，Git Bash / WSL 里有效）。

---

## 7. 常见问题（FAQ）

**Q1. `rea doctor` 报 `healthy: false`，是装坏了吗？**

不是。`healthy: false` 在没装原生引擎的机器上是**预期结果**
（官方原话：healthy can be false while your chosen workflow works）。
检查 `scope_checks` 里的 `node` 和 `host` 两项是否 `ok: true`——
是的话 REA 本身工作正常，缺的只是可选引擎（第 5 节的零依赖能力不受影响）。

**Q2. SQLite 报 "requires Node.js 24.15 or newer"，但我的 Node 明明满足 REA 要求？**

你很可能落在 **24.11–24.14 交叉区间**（满足 REA 整体要求、不满足 SQLite
的额外门槛）。见 2.2：升级到 24.15+/26+，或用独立 Node 目录绕过（不动系统环境）。

**Q3. 为什么输出不是 JSON？**

默认是 TOON。加 `--json`。见 6.1–6.2。

**Q4. `--token-limit` 加 `--format json` 报 `UNSUPPORTED_OUTPUT_COMBINATION`？**

这是设计上的硬约束：token 窗口会破坏结构化输出。改用 `--filter-output`
（生成侧字段裁剪）或命令自带的翻页/分页参数。见 6.4。

**Q5. `--filter-output` 输出了 `{}` 或空对象，但命令没报错？**

字段名写错了。REA 对不存在的字段路径**静默填空**（`{}` 或 `{"外层键":{}}`），
没有报错。先从完整输出里抄字段名，再过滤。见 6.3。

**Q6. `rea capabilities` 里没有我想要的 JS/Go/Rust 能力，是没装好？**

不是。`capabilities` 只报告"按 provider 归组"的操作，零依赖能力
（静态 JS 分析、Go/Rust 检查、网站观察等）**不在其中**。直接跑
对应命令验证即可。见第 5 节。

**Q7.（Windows）传 `/tmp/...` 这样的路径给 REA 后报"文件不存在"？**

Git Bash 的 `/tmp` 实测在
`C:\Users\<你>\AppData\Local\Temp`，而 Node 收到的 `/tmp/x` 会被解析成
`D:\tmp\x`（取决于当前盘符）——两边根本不是一个位置。
解法：`cygpath -w /tmp/x` 转换后再传，或把文件放进项目目录用相对路径。
另：给脚本传 `/` 开头的**非路径参数**时用 `MSYS_NO_PATHCONV=1` 防止被 MSYS 改写。

**Q8.（Windows）手动注册 MCP 时客户端起不来？**

stdio 客户端无法直接启动 npx 的 shim，需要 `cmd.exe /d /c` 包装：

```powershell
claude mcp add --scope local rea -- cmd.exe /d /c npx -y rea-agents@6.5.0 mcp
```

（macOS/Linux 等价命令去掉 `cmd.exe /d /c` 前缀。）
如果刚跑过完整的 `npx rea-agents setup`，这一步通常不需要——setup 已经
自动完成了包装。另外：**别用 `--scope project`**（会往仓库里写可提交的
`.mcp.json`）；`--scope local` 注册不会被 `rea doctor` / `rea uninstall`
报告或移除，需要 `claude mcp remove --scope local rea` 手动清理。

---

## 8. 下一步

装好并跑通第一次之后，按兴趣继续：

- **静态 JS / Electron 应用分析**：`rea analyze-javascript-application <目录或 .asar>`
  ——入门后回报最高的能力（IPC 双端配对、模块图谱）。
- **.NET 程序集**：`rea inspect-managed-artifact` → `inspect-managed-members`
  ——注意全量成员提取有 64 MiB 表示预算，超限时按 `--type` 逐类型提取。
- **配一个原生引擎**（Hopper / Ghidra / IDA）：见官方
  `docs/installation.md` 与 `docs/ida-provider.md`；配好后
  `rea doctor --provider <id> --json` 验证。
- **agent 深度集成**：本手册 `guides/` 下的接入章节；官方
  [client configuration](https://github.com/morluto/rea/blob/main/docs/client-configuration.md)
  有各客户端的配置路径与故障排查。

官方文档索引（本手册所有内容的最终权威）：

- 安装与 setup：`docs/installation.md`
- CLI 与退出状态：`docs/cli.md`
- 工具目录（全部命令与 MCP 工具）：`docs/mcp-contracts.md#generated-catalog`
- 各个能力域的专门 guide：`docs/` 下按主题命名的文件
