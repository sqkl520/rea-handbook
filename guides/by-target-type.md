<!--
  基于 REA 6.8.0（npm 包 rea-agents）编写。
  事实来源：
    - 官方仓库 morluto/rea 的 docs/（63 份 guide，2026-10 快照）
    - 本手册作者的真机实测（Windows 10 x64 / Node 24.14.0（另有 24.18.0 独立副本）/ REA 6.8.0，2026-10-25）
    - 三个真实案例：PCL2（.NET）、ChatGPT 桌面版与 OpenCode 桌面版（Electron）
  标注约定：【实测】= 我们在真实目标上跑通过；【官方】= 来自官方文档描述，我们未实测。
  最后核对日期：2026-10-25。REA 更新很快，行为可能随版本变化；如与官方文档冲突，以官方为准。
-->

# 按目标类型分析：操作指南

> 给已经装好 REA 的人。找到你要分析的东西，复制命令、替换 `<你的目标>` 就能跑。
> 排序从"最容易上手"（零依赖、秒级）到"最麻烦"（需要自备引擎/工具链）；每个小节都标了前置条件。

## 读前必读：四个通用约定

1. **输出格式**：REA 默认输出 TOON。本页所有命令都显式加 `--format json`（等价简写 `--json`；管道/重定向时是紧凑 JSON，终端上会缩进）。要缩进文件就 `| jq .`。
2. **stdout / stderr 分工**：stdout 只有结果文档，进度走 stderr（静态 JS 分析是 `rea_progress` JSON 行）。所以 `> evidence.json` 永远安全，进度不会污染结果。
3. **退出码**：`0` = 操作完成——**但结果可能含 partial / warning / unknown**，要另看 `coverage.status` 与 `limitations`；`1` = 没能完成；`128+N` = 被信号 N 结束。
4. **两个输出选项的硬约束**（【实测】）：
   - `--token-limit` / `--token-offset` **不能**与 `--format json|jsonl|yaml` 同用，会报 `UNSUPPORTED_OUTPUT_COMBINATION`。要缩小结果用 `--filter-output evidence_id,normalized_result.statistics`。
   - `--filter-output` 语法是逗号分隔的字段路径（`a,b.c,d[0,3]`）。写错时**多数情况不报错、静默返回 `{}`**（字段名写错、引用不存在的路径）；**唯一例外**是未闭合的 `[` 切片，会报 `INVALID_OUTPUT_FILTER`。引用不存在的字段会保留外层结构、填空对象。

**平台图例**：可用 / 受限 / 不可用 / 文档未明确。

## 目标类型速查

| # | 目标类型 | 主命令 | 依赖 | 平台 |
| --- | --- | --- | --- | --- |
| 1 | Electron / JavaScript 应用 | `analyze-javascript-application` | 零依赖 | 三平台 |
| 2 | .NET 程序集 | `inspect-managed-artifact` / `-members` | 零依赖 | 三平台 |
| 3 | Go 二进制 | `inspect-go-binary` | 零依赖 | 三平台 |
| 4 | Rust 二进制 | `inspect-rust-binary` | 零依赖 | 三平台 |
| 5 | PE 资源 | `inspect-pe-resources` | 零依赖 | 三平台 |
| 6 | Electron fuses | `inspect-electron-fuses` | 零依赖 | 三平台 |
| 7 | 网站（CDP 被动观察） | `list-browser-targets` 等 | 自备 Chrome 系浏览器 | 三平台 |
| 8 | SQLite | `inspect-sqlite-database` | Node 24.15+ / 26+ | 三平台 |
| 9 | 原生二进制 | `analyze` / `decompile` 等 | Ghidra / Hopper / IDA | 见 §9 表 |
| 10 | Android APK | `inspect-android-package` 等 | JADX 0.7.1 + JDK 17+ | Win x64 / macOS / Linux |
| 11 | 固件 / 信号 / EVM / pcap 等 | 见 §11 | 各自外部工具 | 多为 Linux-only |

---

## 分析 Electron / JavaScript 应用

**一句话**：不运行目标，把 ASAR 或解压目录重建为一张带证据的"应用图谱"——模块、import/require 关系、路由与端点候选、preload/contextBridge 暴露面，以及 **renderer invoke ↔ main handle 按通道名精确配对**的 IPC 链路（两端都带源码行列号），外加 `.node` 原生插件的交接点。

**前置**：**零依赖**（只要 Node.js + npm）。Windows / macOS / Linux 均可用；Linux 上 REA 的进程监督需要 PATH 上有 procps 兼容的 `ps`。它不是 native 引擎，不需要 Hopper/Ghidra/IDA。
**在 Bun 上运行时**（仅 Windows），analyzer 的 Job Object 把提交内存限制为 `max_heap_mb` + 512 MiB（`--max-heap-mb` 默认 1024 MiB，所以这里是 **1536 MiB**）；**Node 下无此进程级限制**，`--max-heap-mb` 的 V8 old-space 预算才是边界。

**命令**：

```bash
# 主命令：ASAR 或解压目录都可以；大目标把结果写进文件
rea analyze-javascript-application "<你的应用>/resources/app.asar" \
  --integrity-policy record-and-continue \
  --format json > evidence.json

# 通用路由：对目录/ASAR 会自动选择这个静态 provider（等价于上一条）
rea analyze "<你的应用>/resources/app.asar" --format json
```

`--integrity-policy` 是这一节最重要的参数（默认 `fail`）。Electron 打包工具常在写完归档头之后对 `.asar.unpacked` 里的原生二进制二次签名/剥离，声明的 SHA-256 与磁盘字节不符，默认策略会直接失败并报 `artifact_integrity_mismatch`（错误里会指出具体逻辑路径与 declared/observed 两个哈希）。加 `record-and-continue` 后：继续分析，把每条矛盾收进 `normalized_result.integrity_contradictions`（带 `trust: "observed-untrusted"`），并把 graph coverage 标为 partial。

常用调节与裁剪参数（【官方】参数含义，【实测】部分使用过）：

```bash
# 只分析指定的源文件（精确的 artifact 相对路径，不支持 glob；可重复）
rea analyze-javascript-application "<asar>" \
  --source-path package.json --source-path main.js --format json

# 分析器堆与单文件时限（官方正路；我们当时未用，见注意事项）
rea analyze-javascript-application "<asar>" \
  --max-heap-mb 2048 --analysis-timeout-ms 600000 --format json

# 生成时就缩小输出（替代 --token-limit）
rea analyze-javascript-application "<asar>" \
  --format json --filter-output evidence_id,normalized_result.statistics
```

大 evidence 的投影与功能追踪：

```bash
# 1) 投影成 summary view（几百 MB 的 evidence 先别直接读）
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' evidence.json > view.json
rea inspect-analysis-view view.json --format json

# ⚠️ view.json 本身也可能是几百 MB（summary 里仍含完整 inline evidence）。
#    默认堆下会报 resource_constraint: Insufficient heap headroom。
#    两个解法：给 Node 加 --max-heap-old-space-size，或者投影时只保留需要的字段：
#    jq -c '{source:{kind:"inline",evidence:{normalized_result:{summary:.normalized_result.summary}}},view:{kind:"summary"}}' evidence.json > view.json

# 视图也可以是模块分页：{"kind":"page","collection":"modules","offset":0,"limit":32}

# 2) 功能追踪：先把 evidence 包成 trace 输入（seed kind 用 string！）
jq -c '{application: ., seed: {kind: "string", value: "kill-sidecar"}, direction: "both"}' \
  evidence.json > trace-input.json
rea trace-application-feature trace-input.json --format json
```

**返回什么**（【实测】OpenCode evidence 的顶层字段）：`evidence_id`、`subject`（路径、SHA-256、`format: "asar"`）、`provider.id: "rea-javascript-application"`、`normalized_result` 下：

- `graph`（`JavaScriptApplicationGraph`：`nodes[]` / `edges[]`，节点带 `kind`、观测属性、`evidence.authority` 与源码位置；**`coverage` 嵌在这里**——`graph.coverage.status`）；
- `semantic_graph`（语义关系图，自带 `coverage`；节点数有上限，触顶时 `truncated: true`）；
- `statistics`：`relevant_files`、`parsed_javascript_files`、`visited_ast_nodes`、`findings`、`text_bytes_read`、`parse_failures` 等；
- `summary`：Electron 表面计数（`browser_windows`、`explicit_web_preferences`、`context_bridge_apis`、`exposed_api_members`、`ipc.operations / literal_channels / main_handlers / paired_renderer_transmissions / ambiguous_renderer_transmissions` 等）；
- `integrity_contradictions`、`limitations`。

（注意：`normalized_result` 顶层**没有** `coverage`——它总在 `graph` / `semantic_graph` 里。）

**实际例子**（【实测】）：OpenCode 桌面版 146 MB 的 `app.asar` 完整跑通（应用图谱层；semantic 层达 100,000 节点上限后截断，`status: partial`）——evidence 354 MB；图谱 **27,278 节点 / 32,977 边 / 7,823 条终端路径**；`statistics` 里 asar 相关文件 6,702、解析 JS 4,489、AST 节点 4,751,494、findings 30,648；`summary.ipc` 163 个操作 / 76 个字面量通道 / 81 个主进程 handler / 55 组配对。追踪 `kill-sidecar` 得到 renderer `out/preload/index.js:11`（invoke）↔ main `out/main/index.js:2069`（handle），并给出 5 个原生交接点（`@parcel/watcher`、`node-pty`、`msgpackr-extract` 等）。反例：ChatGPT 桌面版 567 MB ASAR 只分析到 3,757/16,197 个源文件就因"父进程结果容量耗尽"而 `normalized_result.graph.coverage.status = "partial"`。

**注意事项**：

- **`--integrity-policy` 的坑是常态，不是异常**。遇到 `artifact_integrity_mismatch` 先看错误指认的路径；打包器二次签名/剥离原生二进制是常见原因，加 `record-and-continue` 重跑即可。矛盾会保留在结果里，不要当它不存在。
- **大目标先投影再读**。几万节点 + 几百 MB evidence 直接进上下文不现实：`--filter-output`（跑的时候缩）→ jq summary view（存下来后缩）→ module page（按需翻）。官方数据（【官方】）：334 MB Obsidian evidence 的 summary view 约 10 KB。
- **Node 有 512 MiB 字符串硬墙**（【官方】提到了这个限制，但没给数值）。官方三篇 docs 都称它为 `Node's single-string limit`（`javascript-artifact-reconstruction.md`、`mcp-contracts.md`、`testing.md`），但没有给出 `0x1fffffe8` / 536,870,888 这个数，也没有指出它自己的追溯示例（用 `readFileSync` 读整份 evidence）在几百 MB 上会撞上。**这是本手册补的部分：数值 + 会崩的写法。**`ERR_STRING_TOO_LONG`（`0x1fffffe8` 字节）发生在 `readFileSync(evidence.json, 'utf8')`；570 MB 的 evidence 用 node 读必崩，用 `jq -c` 流式投影可行（视磁盘与目标大小可能到分钟级；且输出 `view.json` 与 evidence 同等大小，先留好空间）。**投影用 jq，不要用 node -e**。
- **功能追踪的 seed kind 用 `string`**（【实测】+ 源码核实）。官方文档把 "IPC channel" 列为合法 seed kind。**`channel` 不是不能用，它的搜索面比 `string` 窄**：源码里 `channel` 只在本节点 `kind === "ipc-channel"` 时参与匹配，匹配字段是 `.label` / `.channel` / `.key`；而实际图谱里通道名往往住在 `javascript-asset` 节点的 `properties.static_analysis.electron.ipc[].channel` 下——那不是我这边 `ipc-channel` 节点，所以搜不到。`string` 是全局包含匹配，能跨节点类型命中。实测 `channel` 对 `kill-sidecar` 返回 no-match，`string` 命中 2 个种子。**结论：拿不准就用 `string`；确定图谱里有 `ipc-channel` 节点时才用 `channel`。**
- **父进程结果容量**：大目标可能中途停止并返回 partial。官方推荐的调节是 `--max-heap-mb` / `--analysis-timeout-ms`（官方正路，我们当时未验证；我们只试过 `NODE_OPTIONS`，无效——worker 环境里 `NODE_OPTIONS` 被 `delete`）。更稳的办法是 `--source-path` 分层喂子集。
- **原生插件是静态分析的尽头**：`.node` 只记录"JS 请求了它"，不解析插件内部。要对交接点继续，用 §9 的原生引擎。
- **Windows / Git Bash 路径坑**（【实测】）：Git Bash 的 `/tmp` 实际在 `%LOCALAPPDATA%\Temp`，Node 收到的 `/tmp/x` 会变成 `D:\tmp\x`——用 `cygpath -w` 转换或把文件放项目目录；传给脚本的 `/` 开头参数被 MSYS 改写时加 `MSYS_NO_PATHCONV=1`；在本仓库（ESM）写辅助脚本要用 `.cjs` 后缀。
- 追踪无匹配时 REA 会明确说"This is not evidence that the feature is absent"——**没找到 ≠ 不存在**。

---

## 分析 .NET 程序集

**一句话**：不加载、不执行程序集，读出它的身份与托管元数据——类型/方法/字段清单、CIL 方法体、调用边与字段访问、声明的 P/Invoke 原生边界，以及 `ldstr` 字符串字面量池；还能跨构建比较成员。

**前置**：**零依赖**（纯静态 TS 解析器）。三平台可用。只接受 PE/CLI 元数据的输入；**不**解包 .NET single-file host、不解码 IL2CPP、不从普通原生 PE 推断 NativeAOT 身份。

**命令**：

```bash
# 1) 先认身份（程序集名、MVID、metadata 状态、分类）
rea inspect-managed-artifact "<你的程序>.exe" --format json

# 2) 成员提取——小程序集可全量；大程序集会撞 64 MiB 表示预算，改用 --type 逐个提
rea inspect-managed-members "<你的程序>.exe" --format json
rea inspect-managed-members "<你的程序>.exe" --type PCL.ModBase --format json
rea inspect-managed-members "<你的程序>.exe" --type PCL.ModBase --type PCL.ModMain --format json

# 3) 原生边界：声明的 P/Invoke 与原生实现标记
rea inspect-managed-native-boundaries "<你的程序>.exe" --format json

# 4) 两个构建的成员比较（按声明类型/名称/签名匹配，名字本身从不作为匹配依据）
rea compare-managed-members "<旧版本>.exe" "<新版本>.exe" --format json
```

**`--type` 的坑**：全量成员解码有**独立的 64 MiB 表示预算**（不是文件大小上限；官方 `docs/managed-code-analysis.md` 的 Resource admission 一节已明确写出这点）。PCL2 只有 5.5 MB，`inspect-managed-members` 全量仍然超预算——`detail` 里写着超出 `67108864` 字节（【实测】；原始输出未入库——那次的 PCL2 二进制已随自更新漂移，重跑对不上）。

**这个坑在 6.8.0 被上游修了一半**，行为与 6.5.0 不同：

| | 6.5.0 | 6.8.0 |
| --- | --- | --- |
| `coverage.state` | `unavailable` | **`partial`** |
| 类型清单 | **拿不到**（`types: 0`） | **完整保留**（同一个 System.dll 给出全部 2,365 个类型） |
| 丢的是什么 | 全部 | members / edges / user_strings / exported_types |
| `issues[0].offset` | `null` | 真实文件偏移 |

机制是 6.8.0 新增的 `ManagedMemberRecovery`：类型清单准入后先预占「部分结果信封」的预算，成员解码超预算时降级为 `partial` 而不是整份失败。

**所以"`--type` 需要类型名、而失败时拿不到类型名"这个死循环，在 6.8.0 上已经不存在了**——
全量跑一次就能拿到清单（只是成员为空）。6.5.0 时代才需要下面这套绕法。空集合**仍然不等于成员不存在**，
这条告诫在任何版本都成立。

如果你还在 6.5.0（或需要从别处拿清单），可行手段：

```powershell
# Windows PowerShell：不用加载执行，只读反射（实测用于 PCL2）
# ⚠️ 对依赖复杂的程序集，直接 .GetTypes() 会抛 ReflectionTypeLoadException——
#    必须在 catch 里取已加载的部分类型，否则拿不到清单：
try {
  [System.Reflection.Assembly]::ReflectionOnlyLoadFrom("<你的程序>.exe").GetTypes() |
    ForEach-Object { $_.FullName }
} catch [System.Reflection.ReflectionTypeLoadException] {
  $_.Exception.Types | Where-Object { $_ } | ForEach-Object { $_.FullName }
}
```

```bash
# 或者直接全量反编译（见下），从源码里抄类型全名
# 或者用本手册 tools/dotnet-metadata.cjs 自解析 PE/CLI 元数据表
```

**ilspycmd：REA 不做反编译，这是它的补充手段**（【实测】）：

```bash
dotnet tool install --global ilspycmd
ilspycmd -p -o "<输出目录>" "<你的程序>.exe"
```

产出可读源码；语言可能改变（VB.NET 反编译成 C#），但命名和结构准确——适合"学设计"，不适合逐字符比对。把 ilspycmd 的源码阅读与 REA 的 CIL token/调用边/字符串池互相印证。

**返回什么**（【实测】PCL2 `--type PCL.ModBase` 输出结构）：`artifact`（path/sha256/byte_length/format）、`module`、`metadata`（status、table_row_counts）、`identity_scope`（`token_identity: "build-local"`，跨构建匹配需要 artifact SHA-256 + MVID）、`types[]`（token、namespace、name、full_name、extends_token、field_list、method_list）、`fields[]`、`methods[]`（token、declaring_type、name、signature、`body`）、`member_refs[]`、`call_edges[]`、`field_accesses[]`、`user_strings`（`state`、`literals`、`issues`——`ldstr` 的 0x70 token 与解码值）、`selection`（`type_names`、`unmatched_type_names`）、`coverage`（state/issues）、`limitations`。

**实际例子**（【实测】）：PCL2 v2.13.1.1（5.5 MB，WPF + VB.NET）——`inspect-managed-artifact` 得到 643 个类型 / 6,116 方法 / 3,503 字段 / 23 个程序集引用；`inspect-managed-members --type PCL.ModBase` 单独取出 **47 个方法、26 个字段**，`coverage.status: "complete"`、`selection.type_names: ["PCL.ModBase"]`。另一个实测样本 `System.dll`：2,365 个 TypeDef / 18,170 个 MethodDef。`inspect-managed-native-boundaries` 显示 PCL2 只有 8 条模块引用（其中 `user32.dll`/`User32` 是大小写重复；去重 6 个 DLL，没有 winhttp/wininet/ws2_32）→ 网络全走 .NET 托管栈，可据此判断"纯托管应用"。

**注意事项**：

- **类型名会骗人**（【实测】，最有教育价值的一条）：`PageLinkMain` 看着像主页，实际是联机页（私有字段 `NATType` / `NetworkSecret`，邀请码由 `GetInviteCode()` 现拼，不存储）；`MySkin` 看着像主题引擎，实际是 Minecraft 皮肤预览控件。**交叉验证字段名、方法名、CIL 字符串，别按名字猜**。
- `--type` 要匹配报告的 `full_name`（顶层类型带命名空间）；**嵌套类型目前报告裸名**，同名嵌套类型会被一次选中多个。选中后 `member_refs` / `exported_types` 仍是全程序集清单，输出不保证小。
- token 是 **build-local** 的：`0x06001234` 换个 MVID 就不是同一个方法。跨构建比较用 `compare-managed-members`，它按 CIL/签名/结构重新匹配。
- `user_strings` 只覆盖被检查方法加载的字面量；`state` 可能为 partial（某方法的 CIL 未完整解码时）。字符串堆的编码注意：解析 `#US` token 时 offset 要 -1（我们自写脚本的经验）。
- **这是静态分析，不是运行时**：看到调用边不代表运行时会走到；P/Invoke 声明不代表真的调用。
- 用文件内容判类型，不要用扩展名：`.exe` 可能是原生 NativeAOT；无 CLI 元数据的 PE 不会"因为命名"变成托管程序集。

---

## 分析 Go 二进制

**一句话**：秒级读出内嵌的 Go 构建信息——编译器版本、主模块、**完整依赖清单（每条带 `h1:` 校验和）**、build settings（GOOS/GOARCH/vcs.revision）——不需要安装 Go。

**前置**：**零依赖**。支持 ELF、PE、thin Mach-O；不把 fat Mach-O 当单一架构解释。符号链接与非普通文件被拒绝；输入上限 256 MiB。

**命令**：

```bash
rea inspect-go-binary "<你的Go程序>" --format json
```

**返回什么**：`subject`（路径、SHA-256、`format`、架构）；`normalized_result.build_info`：

- `go_version`（原样文本，如 `go1.27.1`；非 UTF-8 时为 null，另有 `go_version_bytes_base64`）；
- `module.main` 与 `module.dependencies[]`：`{path, version, sum, replacement}`，依赖保持原始顺序；
- `module.settings[]`：有序键值（`GOOS`、`GOARCH`、`vcs.revision` 等，重复键保留）；
- `module.complete`、`module.unparsed_lines`（不认识的记录不会悄悄消失）；
- 头部/编译器串/模块串的精确文件 offset 与长度。

**实际例子**（【实测】）：`gh.exe`（GitHub CLI）→ `go1.27.1`、主模块 `github.com/cli/cli/v2 v2.102.0`、**165 条依赖**（首条 `charm.land/bubbles/v2 v2.2.1`，带 `h1:Fq1+qm5hV6GkvzLQDhCBpXXE5tLgvh1PRriCLwSvIQU=`）、15 条 build settings、`complete: true`。整个过程秒级。

**注意事项**：

- `build_info: null` **不等于**目标不是 Go——剥离、老版本、故意移除、混淆都可能让记录消失；它是"没找到可用记录"，不是否定证据。
- 内嵌元数据是**文件内容证据**，不认证编译器/依赖/提交的真实性，也不证明运行时行为。要函数名/源码映射/反汇编，走 §9 原生路线。
- `module.unparsed_lines` 不为空说明有记录没读懂，别当完整清单用。

---

## 分析 Rust 二进制

**一句话**：读取 cargo-auditable 嵌入在二进制里的 `.dep-v0` 段——crate 名、版本、来源、依赖边与根包，用于回答"这程序用了哪些 Rust 库、什么版本"。

**前置**：**零依赖**。支持 ELF/PE/thin Mach-O；universal Mach-O 容器不支持（先选 thin slice）。**目标必须是用 cargo-auditable 构建的**（构建时嵌入 `.dep-v0`），否则什么都没有。文件上限 256 MiB。

**命令**：

```bash
rea inspect-rust-binary "<你的Rust程序>" --format json
```

**返回什么**（【官方】字段定义）：`artifact`、`format`、`architecture`、`bits`、`byte_order`；`auditable_metadata` 存在时包含 `section_name`（ELF/PE 为 `.dep-v0`，thin Mach-O 为 `__DATA,.dep-v0`）、`file_offset`、`compressed_bytes` / `uncompressed_bytes`、`format_version`、`packages[]`（`name`、`version`、`source`、`kind`、`dependencies`、`root`）、`root_package_index`、`dependency_edges[]`（包索引对）、`cyclic_dependency_indices[]`；`rustc_commit` 仅当只读数据里出现 `/rustc/<40-hex>/` 路径时存在，且标注 `evidence_kind: "inferred"`（只是线索，不是"这个编译器产出了它"的证明）。

**实际例子**（【实测】+【官方】）：我们用本机的 `rg.exe`（ripgrep，5.4 MB PE）实测跑通命令，但结果 `auditable_metadata: null`——该发布版没有嵌入 `.dep-v0` 段（不是 cargo-auditable 构建），同时在 `limitations` 里明确说明"只有 `.dep-v0` 段和编译器路径串会被检查"。**带完整依赖清单的正例我们未实测**；`packages` 等字段结构来自官方文档。这本身就是最重要的实测结论：**大多数普通发布版 Rust 二进制都会得到 null**。

**注意事项**：

- **`auditable_metadata: null` ≠ 没有依赖**。官方原话：absence of `.dep-v0` does not mean the binary has no dependencies。它只说明构建时没嵌这个段。
- 段缺失时命令仍以成功返回（带 limitation），不是错误——别把 null 当分析失败。
- 段压缩后上限 1 MiB，完整报告上限 8 MiB；空段、截断 zlib、坏 JSON、未知字段、越界依赖索引都是类型化失败。
- 依赖清单同样"不认证包或编译器"——它是构建者声明的文件内容。

---

## 分析 PE 资源

**一句话**：解析 PE32/PE32+ 的资源目录——类型/名称/语言三元组身份、目录项与 payload 的原始偏移/长度、每个 payload 的 SHA-256、以及 `RT_GROUP_ICON` 与 `RT_ICON` 的图标组关系。不需要 Windows SDK、Python 或原生引擎。

**前置**：**零依赖**，三平台可用（纯静态解析，读的是 PE 字节）。只接受普通文件，拒绝符号链接。默认最多读 64 MiB（`--max-file-bytes`，上限 512 MiB）、最多 16,384 个目录项（`--max-entries`，上限 65,536）。

**命令**：

```bash
rea inspect-pe-resources "<你的程序>.exe" --format json

# Windows 上随手可试的目标
rea inspect-pe-resources "C:/Windows/System32/notepad.exe" --format json
```

**返回什么**（【实测】notepad.exe 输出结构）：`format`（`pe32` / `pe32-plus`）、`machine`（34404 = x64）、`directory`（资源目录的 RVA 与文件位置）、`directories[]`、`resources[]`（`index`、`type`/`name`/`language` 各自是 `{kind: "id"|"name", utf16le_hex, location}`——数字 ID 与 UTF-16 名称严格区分且保留原始字节、`entry_locations`、`data_entry_location`、`code_page`、`reserved`、`payload`（偏移/长度/SHA-256））、`icon_groups`、`coverage`、`limitations`。

**实际例子**（【实测】）：`notepad.exe`（Win10 19045，200,704 字节）→ `pe32-plus`、machine 34404、5 个资源，其中包括名称型条目 `EDPENLIGHTENEDAPPINFO`（同时给出 `utf16le_hex` 原始字节）。这是"看某个 PE 里有没有清单/图标/版本信息"最快的入口。

**注意事项**：

- 支持的是**三层资源树**（type → name → language）；其他形状显式失败，不会返回部分清单。资源数据目录缺失 = 完整的空清单（这是成功，不是错误）。
- 除图标组关系外，payload 格式保持 **opaque**——它不解析对话框/字符串表/版本结构的内容，只给身份、区间与哈希。
- 恶意/畸形输入宁可报错也不截断：坏头、截断表、循环、重复兄弟身份、无法映射的 RVA 都显式失败。
- 与 §2 的 `inspect-managed-native-boundaries` 互补：那个看 P/Invoke 声明，这个看资源。

---

## 检查 Electron fuses

**一句话**：秒级读出打包进 Electron 主程序的 9 个 fuse 开关状态——应用是否还认 `--inspect` / `--inspect-brk`、`ELECTRON_RUN_AS_NODE` 是否可用、嵌入的 ASAR 完整性校验是否强制、是否只允许从 `app.asar` 加载代码。

**前置**：**零依赖**，纯静态读取，不启动应用、不改字节。macOS 传 `.app` 包或 Electron Framework 二进制；Windows / Linux 传主可执行文件（fuse 线在 exe 里，不在 app.asar）。

**命令**：

```bash
# Windows / Linux：主可执行文件
rea inspect-electron-fuses "<你的应用目录>/<应用>.exe" --format json

# macOS：.app 包也可以
rea inspect-electron-fuses "/Applications/<应用>.app" --format json
```

**返回什么**：`fuses[]`（`index`、`name`、`state: enabled|disabled|removed|unknown`、`raw_byte`——`0x31` 启用 / `0x30` 禁用 / `0x72` 移除）、`wire_version`、`sentinel_count`、`runtime_implications`（每条标 `relationship: "derivation"` 并绑定来源 fuse 索引）。版本 1 的 9 个名字：`RunAsNode`、`EnableCookieEncryption`、`EnableNodeOptionsEnvironmentVariable`、`EnableNodeCliInspectArguments`、`EnableEmbeddedAsarIntegrityValidation`、`OnlyLoadAppFromAsar`、`LoadBrowserProcessSpecificV8Snapshot`、`GrantFileProtocolExtraPrivileges`、`WasmTrapHandlers`。

**实际例子**（【实测】）：OpenCode 桌面版 `OpenCode.exe` → 9 个 fuse 全部读出：`RunAsNode: enabled`、`EnableNodeCliInspectArguments: enabled`、`EnableEmbeddedAsarIntegrityValidation: disabled`、`OnlyLoadAppFromAsar: disabled`，等等。含义：它运行时可以被 Inspector 接入（配合 §1 的静态证据与运行时观察），但嵌入 ASAR 完整性校验没开——与 §1 里 `--integrity-policy` 遇到的实际状况相互印证。

**注意事项**：

- **`removed` 不等于 `enabled`**：被移除的 fuse 不生效——Inspector 标志不被采纳、`ELECTRON_RUN_AS_NODE` 无效、代码加载不受 `app.asar` 限制。
- **没有 sentinel = 状态未知**，不是"全部禁用"；一个 slice 里出现多个 sentinel 时全部报告，REA 不替你选。
- Linux ELF 上 `EnableEmbeddedAsarIntegrityValidation` 的字节会被保留，但**强制结果标 unknown**（Electron 只在 macOS/Windows 编译这段校验）。
- fuse 字节不证明应用没有别的办法开 Inspector（例如应用代码里 `app.commandLine`）。
- 这是"能不能做运行时观察"的前置检查：`EnableNodeCliInspectArguments` 被禁用或移除时，后续 `observe-javascript-runtime`（electron-main）会列不出主进程 target。**先看 fuses，再决定要不要接运行时**。

---

## 观察网站（CDP）

**一句话**：通过 Chrome DevTools Protocol 被动观察一个**已经在运行**的页面：DOM 与可访问性结构、脚本（可选完整源码 + SHA-256）、资源清单、attach 后的网络/控制台/WebSocket 元数据、存储键名（值始终脱敏）、可选截图；还能对页面 bundle 做静态分析（chunk 依赖边、路由/端点候选、source map）。

**前置**：**你自己启动**一个 Chrome 系浏览器（Chrome / Chromium / Brave / Edge），带调试端口和**独立的 `--user-data-dir`**。REA 从不启动、不拥有、不关闭这个浏览器。

**CDP 端点格式是这个能力最大的坑（官方明确，`localhost` 会被拒绝！）**：端点只能是

- `http://127.0.0.1:PORT`（`[::1]` 可代替 `127.0.0.1`），或
- `ws://127.0.0.1:PORT/devtools/browser/<id>`（浏览器 WebSocket，用于没有 HTTP 发现端点的浏览器）。

`localhost`、私网局域网地址、HTTPS/wss、带凭据、带 query/fragment、隐式端口、其他路径**都不是合法端点**。另外 Chrome 136+ 对默认 profile 忽略 `--remote-debugging-port`——必须配独立 `--user-data-dir`；Chrome 144+ 也可以在运行中的浏览器用 `chrome://inspect/#remote-debugging` 打开一个浏览器 socket（此时用 ws 端点）。

**命令**：

```bash
# 0) 启动浏览器（三平台；示例用本地测试页）
# macOS:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/rea-browser-profile http://127.0.0.1:3000
# Linux:
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/rea-browser-profile http://127.0.0.1:3000
# Windows（Git Bash；实测用 headless=new + 独立 profile）:
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
  --remote-debugging-port=9222 --user-data-dir="$TEMP/rea-browser-profile" http://127.0.0.1:3000

# 1) 列出 targets，拿到 target_id
rea list-browser-targets http://127.0.0.1:9222 --format json

# 2) 观察页面（默认观察窗口 500 ms；需要脚本源码时显式要求）
rea inspect-web-page http://127.0.0.1:9222 <TARGET_ID> \
  --observation-ms 1000 --include-script-sources --format json

# 3) bundle 静态分析（可选抓 source map）
rea analyze-web-bundle http://127.0.0.1:9222 <TARGET_ID> --fetch-source-maps --format json

# 4) 用户操作观察窗口（你自己点，REA 记录导航/重载/生命周期事件）
rea observe-web-session http://127.0.0.1:9222 <TARGET_ID> --observation-ms 10000 --format json

# 5) 可见视口截图（内容寻址 PNG）
rea capture-web-screenshot http://127.0.0.1:9222 <TARGET_ID> --format json
```

**返回什么**：`targets[]`（`target_id`、URL、title 等）；页面观察含 frames、DOM 与可访问性节点、脚本元数据与（显式要求时的）源码 + SHA-256、资源清单、网络/控制台/WebSocket 观测、worker 清单；coverage 状态是 `complete_within_window` / `policy_filtered` / `attach_limited` / `truncated` 之一。bundle 分析含 chunk 依赖边、路由/端点候选、vendor 指纹与 source map 证据。

**实际例子**（【实测】）：本地起 `python -m http.server` + headless Chrome，`list-browser-targets http://127.0.0.1:9222` 拿到 target_id；`inspect-web-page --include-script-sources` 抓到 27 个 DOM 节点、完整脚本源码 + SHA-256、`resource_reconciliation: exact`；`analyze-web-bundle` 给出 chunk 依赖边、路由/端点候选与完整性报告（测试页规模：229 个 AST 节点）。

**注意事项**：

- **端点写 `127.0.0.1`，不要写 `localhost`**——这是官方文档写明、我们也实测确认的拒绝规则。
- **网络/控制台观测从 attach 才开始**：`prior_activity_available` 恒为 `false`，attach 之前的请求不会补录。脚本不一样——页面在 attach 前已解析的脚本仍会列出。
- 观察默认限定在所选页面的**当前 origin**；要跨 origin 用 `--allowed-origins`（精确 scheme+host+port，不支持通配符）。
- **数据最小化**：DOM 只留节点结构不留文本/属性值；存储值始终脱敏（键名要显式选）；Cookie/Authorization 永不保留；JSON/WebSocket body 只留"结构形状"不留值。要可访问性名称、控制台文本、脚本内容，都需要显式 `--include-*`。
- 单条 CDP WebSocket 消息上限 64 MiB；更大的回复报 `payload_limit`。
- 这是**被动**能力：不导航、不点击、不 evaluate、不调 WebMCP 工具。它也不是网络沙箱——页面继续以原权限运行。
- Linux 上桌面 keyring 可能卡住 Chrome 启动（专用 profile 加 `--password-store=basic`）；最小容器里 headless Chrome 可能 DEVtools 端口不开，需要 GLES/EGL/Mesa 库。
- Electron 的 `file://` 页面有单独入口：`list-electron-targets` / `inspect-electron-page`（目标页必须是本地文件）。

---

## 分析 SQLite 数据库

**一句话**：读一个本地 SQLite 快照的 schema（表、索引、视图、触发器；可选全量声明）并抽样普通表的行——不需要单独安装 SQLite。

**前置**：**Node.js 有更严的独立门槛**：`24.x >= 24.15` 或 `26+`，因为需要原生 `DatabaseSync.limits` API。REA 整体要求（`^22.19 || ^24.11 || >=26`）在这里**不够**——`24.11 ~ 24.14` 是"满足整体、不满足 SQLite"的交叉陷阱：`rea capabilities` 会报 `available: false`、`availability_code: "unsupported_version"`（这条命令本身仍正常返回——这正是你确认门槛的方式），而 `inspect-sqlite-database` 的**任何调用都会以 `capability_unavailable` 失败**——包括默认的 schema inventory。

**命令**：

```bash
# 先确认这台机器上的 sqlite 检查是否可用
rea capabilities --format json

# schema 清单（默认 inventory 范围：紧凑的表元数据 + 索引/视图/触发器名）
rea inspect-sqlite-database "<你的数据库>.sqlite" --format json

# 选一张普通表抽样（列名精确、按给定顺序；行数默认 20）
rea inspect-sqlite-database "<你的数据库>.sqlite" \
  --table settings --column key --column value --row-limit 20 --format json

# 全量 schema（展开所有存储声明与列）
rea inspect-sqlite-database "<你的数据库>.sqlite" --schema-scope database --format json
```

Node 版本不够时（【实测】的绕过法，不动系统 Node）：

```bash
# 下载并解压一份满足门槛的独立 Node（6.8.0 下要 24.22.1+ 或 26.12.1+），用绝对路径调用
N24="<你解压的 node 目录>/node.exe"          # POSIX：<解压目录>/bin/node
REA_JS="<npm 全局目录>/node_modules/rea-agents/scripts/rea.mjs"
"$N24" "$REA_JS" inspect-sqlite-database "<你的数据库>.sqlite" \
  --table ItemTable --column key --row-limit 15 --format json
```

> 选哪个版本要小心：6.8.0 的整体门槛是 `^22.23.4 || ^24.22.1 || >=26.12.1`。
> 24.15–24.21 和 26.0–26.11 虽然能满足 SQLite，但**装不上 REA**（`EBADENGINE`）。

**返回什么**：所选范围的 schema（表/索引/视图/触发器；虚拟表与影子表会被标记）、`completeness` 与省略的列；行样本——**SQLite 整数以十进制字符串返回**（保住全部 64 位）、实数保持数字（`"Infinity"`/`"-0"` 有显式表示）、文本给解码串 + 原始字节 hex + 数据库编码、blob 是 hex、NULL 是带标签的独立值；数据库与（存在的）`-wal` 各自有 SHA-256 与字节数；SQLite 引擎版本随结果报告。

**实际例子**（【实测】）：系统 Node 24.14.0 下 `capabilities` 报 sqlite 不可用；用独立 Node 24.18.0 直接调 `rea.mjs` 跑通——读出了 SQLite 3.53.1 的结构，`--table ItemTable --column key --row-limit 15` 拿到了行样本。

**注意事项**：

- **要拿静止快照**：先停写者，或用应用自己的备份流程拿到一致的数据库/WAL 对。活库文件复制**不**构成原子快照。
- REA 会把数据库与 WAL **复制到私有临时目录**再用 SQLite 打开，原文件不会被 SQLite 锁定或修改；扩展加载与 schema 信任被禁用。
- 只支持普通表的行读取；视图、虚拟表、影子表的行会拒绝。`row_limit` 需要 `table`，列选择需要至少一个列名。
- 加密数据库、数据库修复、任意 SQL、跨库查询、实时抓取都在覆盖之外。
- 上限：db + WAL 合计 256 MiB；worker 256 MiB JS 堆与 30 秒时限；同一 provider 最多 2 个并发检查。
- 行序未定义；被截断的样本不能证明被省略记录的任何事情。

---

## 分析原生二进制（Ghidra / Hopper / IDA）

**一句话**：对任意原生目标做函数清单、反汇编、伪代码反编译、交叉引用、字符串/字节搜索——这是真正"读代码"的能力，也是唯一需要你自备重型引擎的一类。

**前置**：三选一引擎，**平台差异最大**（【官方】，我们本机未装任何引擎、未实测）：

| 引擎 | Windows | macOS | Linux | 要求 |
| --- | --- | --- | --- | --- |
| **Ghidra** | 受限：实验性**只读 P0**。仅 Win10+ x64、仅原生 x86 / x86-64 的 PE 应用与 DLL、加显式选择的 raw NMOS 6502 镜像；**固定本地 NTFS 卷**；不能改名/注释 | 可用（x64/arm64），支持函数改名与入口注释 | 可用（x64/arm64），同上 | Ghidra 12.1.x + 64 位完整 JDK（12.1 要求 21+，无上限）；每个安装需含宿主架构的原生 decompiler；`GHIDRA_INSTALL_DIR` + `JAVA_HOME` |
| **Hopper** | **明确不可用**（"Hopper installation remains unavailable on Windows"） | 可用（macOS 12+）；`.hop` 数据库在 macOS 上被拒绝 | 可用（Ubuntu 24.04+ / Fedora 41+ / Arch 等，官方安装器支持） | 可经 `rea setup --install-hopper` 安装（配 `--yes`）；或 `HOPPER_LAUNCHER_PATH` |
| **IDA** | 需自备 IDA Pro/Free + 上游 IDA MCP（`REA_IDA_MCP_CONFIG`）；官方验证过 Windows x64 headless（IDA 9.3） | 官方验证过 macOS arm64 headless（IDA 9.1） | 文档未声明（headless 引擎操作待真实工作流验证） | REA 不安装/升级/授权 IDA |

**通用流程**（以 Ghidra 为例）：

```bash
# 1) 配置与诊断（6.8.0: hopper|ghidra|ida|jadx|kuna 五个 id）
export GHIDRA_INSTALL_DIR=/absolute/path/to/ghidra_12.1.4_PUBLIC
export JAVA_HOME=/absolute/path/to/jdk-21        # java/javac 在 PATH 上时可省
rea doctor --provider ghidra --format json
rea providers --format json

# 2) 概览 + 找到入口/函数
rea inspect "<你的程序>" --provider ghidra --format json
rea search "<你的程序>" entry --kind procedures --provider ghidra --format json

# 3) 函数档案 / 反汇编 / 伪代码 / 交叉引用
rea function "<你的程序>" main --provider ghidra --format json
rea instructions "<你的程序>" main --provider ghidra --format json
rea decompile "<你的程序>" 0x1000 --provider ghidra --format json
rea xrefs "<你的程序>" 0x1000 --provider ghidra --format json

# 4) Ghidra 特有：按源文件字节偏移反编译（其他操作仍是分析地址语义）
rea decompile "<你的程序>" --file-offset=0x1013 --provider ghidra --format json

# 5) 字符串搜索与掩码字节搜索
rea search "<你的程序>" "license" --provider ghidra --format json
rea search-bytes "<你的程序>" '48 8B ?? ?? 89' --provider ghidra --format json

# 6) 复用分析快照，避免每次都重新导入
rea analyze "<你的程序>" --provider ghidra --snapshot "<快照>.json" --format json
```

Windows PowerShell 的环境变量写法：

```powershell
$env:GHIDRA_INSTALL_DIR = "C:\tools\ghidra_12.1.4_PUBLIC"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
rea doctor --format json
rea providers --format json
```

以 `-` 开头的名字（Objective-C 方法等）用等号形式：`rea function ./app '--procedure=-[REAWidget delegate]' --provider hopper --format json`。

**返回什么**：`analyze`/`inspect` 概览（文档、镜像基址、段）；`function` 函数档案（入口、分类 external/thunk、已解析的 callers/callees、CFG、受限的 p-code 值流）；`decompile` 伪代码文本；`instructions` 原始汇编清单；`xrefs` 带引用类型（call/jump/data/read/write/indirect…）的引用边；`search-bytes` 命中（地址、段、唯一文件偏移、所在函数）+ `next_cursor` 分页（默认 100 条/页，1~1000）。

**实际例子**：**未实测**——本机 Windows 10 上没装任何引擎，`rea doctor` 明确报告 hopper、ghidra、ida、jadx 全部缺失（hopper 的 availability_code 是 `unsupported_host`，其余 `not_configured`）。以上命令与返回结构全部来自官方文档描述。在 Windows 上开始前务必先跑 `rea doctor --provider ghidra --format json`，它会区分"没装/装错"与"这台机器不支持"。

**注意事项**：

- **Windows Ghidra P0 是只读的**：`annotate_native_function` / `set_address_name` 在 Windows 上被明确拒绝（reason: "Windows Ghidra P0 does not admit database mutation"）；且只收 x86/x86-64 PE，UNC 路径、reparse 路径、非 NTFS 卷直接拒绝。NativeAOT 的 rehydrated 字节读取（`read_bytes` / `search_strings`）在 Windows 上返回空。
- **首次查询慢**：Ghidra 的导入 + 自动分析是懒启动的，冷导入可能超过客户端默认超时（真实验证车道给 330 秒 provider 启动期限）。之后的查询才快。
- **provider 绑定是粘性的**：一次会话绑定一个引擎；运行时失败**不会**自动换引擎（也从不自动回退到 Hopper）。多引擎可用时显式 `--provider` 选择。
- **Ghidra 的字符串搜索只覆盖它定义成 string 的 Data**：打包/未定义的字面量（包括 Rust 字符串）可能不在结果里——空结果 ≠ 文本不存在。
- **ELF 虚拟地址 ≠ 文件偏移**：Ghidra 可能对 PIE ELF 重定基（官方文档的验证样例：ELF 入口 `0x1013` 变成 Ghidra 过程 `0x101013`，镜像基址 `0x100000`），这不是通用换算规则。需要时用 `address-to-file-offset` 或 `--file-offset`（仅限 `decompile`）。
- 取消活动请求会终止临时数据库并丢弃注释；有 metadata 编辑的会话不能保存快照（用 `evidence-export` 保留成果）。
- 同一目标的 PDB 不会被采纳（REA 导入私有副本，不搜索符号服务器）。
- macOS 上可直接把 `.app` 包传给 `analyze`。注意源码里 `isJavaScriptApplicationPath()` 对 `.app` **明确返回 false**——它不走 JS lane，会按原生二进制处理。要分析 Electron 应用的 JS，请指向里面的 `Contents/Resources/app.asar`。Hopper 的掩码字节搜索尚未验证（`capabilities` 明确报 unavailable）。

---

## 分析 Android APK

**一句话**：用一个 headless JADX 引擎静态解析 APK——解码后的 Manifest、权限与组件声明、类清单、类成员、方法反编译（Java 或 smali 回退）、入向引用追踪。不执行 APK。

**前置**（【官方】，我们本机未配置、未实测）：调用方自备 **jadx-headless-mcp 0.7.1** 的 JAR + **完整 JDK 17+**（必须含 `jdk.compiler` 模块——只有 JRE 不够）。REA 不下载/安装 Java 或 JADX。

- 平台：macOS arm64（已用 OpenJDK 21 + ApiDemos 验证）、Windows x64（用 JDK 21 + 固定 JAR 真实验证过；**Windows arm64 明确排除**）、Linux 受支持但新桥尚未真实验证；Linux 需要 procps 兼容的 `ps`。
- 环境变量：`REA_JADX_MCP_JAR`（绝对路径），可选 `JAVA_HOME`。

```bash
# 获取固定版本的 JAR（macOS / Linux；SHA-256 与 REA 的 pin 一致）
mkdir -p "$HOME/.local/share/rea/android" && cd "$HOME/.local/share/rea/android" && \
curl -fL -o jadx-headless-mcp-0.7.1-all.jar \
  https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar && \
echo '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75  jadx-headless-mcp-0.7.1-all.jar' | sha256sum -c -
export REA_JADX_MCP_JAR="$PWD/jadx-headless-mcp-0.7.1-all.jar"
export JAVA_HOME=/absolute/path/to/existing-jdk     # 可选
```

Windows PowerShell 用 `Invoke-WebRequest` 下载同一 URL，并用 `Get-FileHash -Algorithm SHA256` 核对同一个哈希，再 `$env:REA_JADX_MCP_JAR = $jar`（官方文档给了完整片段）。

**命令**：

```bash
# 1) 包检查：Manifest 声明、权限、组件与类/资源计数
rea inspect-android-package "<你的应用>.apk" --format json

# 2) 搜类名（空 query = 全量类清单）
rea search-android-classes "<你的应用>.apk" MainActivity --format json

# 3) 看类的成员清单
rea inspect-android-class "<你的应用>.apk" example.MainActivity --format json

# 4) 反编译方法（重载有歧义时必须显式指定 index）
rea inspect-android-method "<你的应用>.apk" example.MainActivity onCreate --format json
rea inspect-android-method "<你的应用>.apk" example.MainActivity select --overload-index 1 --format json

# 5) 入向引用追踪（可限定到某个方法）
rea trace-android-references "<你的应用>.apk" example.MainActivity --format json
rea trace-android-references "<你的应用>.apk" example.MainActivity --method-name onCreate --format json
```

**返回什么**（【官方】）：包检查——解码出的 manifest XML 文本、摘要声明、权限、类/资源计数（`signature verification` 明确标注 `not_performed`）；类检查——展示类型、字段、内部类名、精确 DEX 原型（`dex_descriptor`，如 `(I)V`）；方法检查——Java 或 smali 文本（native/abstract 方法 `body_status: "not_available"`、`<clinit>` 返回 smali）、重载 index 与展示签名；引用追踪——入向静态关系、`direct_invokes`（DEX 条目、方法 ID、code-unit 偏移、opcode）。

**实际例子**：**未实测**（本机没有 JADX JAR/JDK 配置，`doctor` 报 jadx `missing_analysis_engine`）。官方文档给出的工作流示例：`inspect-android-package` → `search-android-classes MainActivity` → `inspect-android-class` → `inspect-android-method --overload-index`。

**注意事项**：

- **JDK 必须是"完整"的**：`java --list-modules` 要能看到 `jdk.compiler`；只有运行时的 JRE 启不动桥。
- **APK 不会被拆包**：不支持 split APK / AAB（`.aab` 后缀只是 ZIP，不是 APK）；不做签名验证；不做 native 库分析；不做 Android 运行时抓取。
- **重载歧义会拒绝而不是猜**：同一方法名的多个重载必须给 `--overload-index`；这个 index 绑定当前 artifact 与引擎，**跨构建不稳定**。
- 类名是**反编译器表示**；静态引用不代表运行时调用，反射/动态加载不在覆盖里。
- 单次操作到队首后 120 秒 deadline，反编译上游限 90 秒；Manifest 与方法文本各 1 MiB 上游预算（会报告截断）；会话空闲 60 秒后清理。
- Flutter 的 APK 有**零依赖**的先行路线：`rea identify-flutter-build "<app>.apk"`（Dart 快照哈希 + 每 ABI 库摘要）与 `rea inspect-dart-aot "<app>.apk" --abi arm64-v8a`，不需要 JADX。HarmonyOS 包（`.hap`/`.hsp`/`.app`）用 `rea inspect-artifact` + `rea project-harmony-application-graph`，同样零依赖。

---

## 仅 Linux 的能力（固件、信号、EVM、pcap 等）

**一句话**：这些能力要么明确拒绝 macOS/Windows，要么验证语境仅限 Linux x64。多数需要 util-linux 的 `prlimit` 和外部工具，用环境变量指向调用方自备的安装。全部【官方】、未实测。

| 能力 | 命令 | 外部前置 | 平台 |
| --- | --- | --- | --- |
| 固件区域/解包 | `rea inspect-firmware-regions <固件.bin>` / `rea extract-firmware <固件.bin> <输出目录> [--offset 64 --length 4096 --max-depth 3]` | Binwalk 3.1.x + Unblob 26.6.x（`REA_BINWALK_COMMAND` / `REA_UNBLOB_COMMAND`）、prlimit、procps `ps` | 验证于 Linux x64 |
| 数据包字段 | `rea inspect-packet-capture <捕获.pcapng> --fields ip.addr --display_filter 'udp'`；`rea inspect-packet-fields --query usb` | TShark 4.x + prlimit（`REA_TSHARK_COMMAND`） | **Linux only**；macOS/Windows 在检查前被拒绝 |
| pcap 摘要 | `rea inspect-pcap-capture <捕获.pcapng>`；`rea inspect-pcap-client` | tshark + capinfos（`REA_CAPINFOS_COMMAND`） | Linux（prlimit）或 Windows（Job Object）；**macOS 报 capability gap** |
| 信号录制 | `rea decode-signal-recording <录制.vcd> --decoders uart:rx=RX:baudrate=9600 --input_format vcd`；`rea inspect-signal-decoders --query uart` | sigrok-cli 0.7.2 + libsigrokdecode + prlimit（`REA_SIGROK_COMMAND`） | **Linux only**；macOS/Windows 被拒绝 |
| EVM 字节码 | `rea inspect-evm-interface <runtime.hex> hex`（或 `<runtime.bin> raw`） | 内置 EVMole 0.9.3（随包）；需 prlimit | 验证于 Linux x64 |
| 离线 ELF 布局 | `REA_PWNTOOLS_PYTHON=<python> rea inspect-binary-layout <selected.elf>` | 孤立 Python 环境，含未改动的 pwntools 4.15.0 / pyelftools 0.33 / Unicorn 2.1.2 | 验证于 Linux x64 |
| 记录的崩溃 | `rea inspect-recorded-crash <core> --debugger-context` | 同上 pwntools 路线；可选 GDB/pwndbg | Linux ELF64 core（amd64 / AArch64） |
| 网络捕获原生解码 | `REA_MITMDUMP_COMMAND=<mitmdump> rea inspect-web-network-capture <session.mitm> mitmproxy` | mitmdump 12.2.3 | **Linux only**；HAR / SAZ / qlog 离线解码跨平台 |
| GDB / Rizin 会话 | `rea debug-with-gdb "<命令>" --inferior-tty <tty>`；`rea debug-with-rizin` | 调用方 GDB / Rizin | **Linux only**（依赖 `/proc`） |
| 进程捕获 | `rea capture-process <场景>` | 原生 PTY | Linux / macOS；**Windows 新捕获不可用**（只能比较已有 Evidence） |
| 历史源码导入 | `rea import-reference-source <源码目录>` | 无 | macOS / Linux；**Windows 原生直接 `unsupported_host`**（改用 WSL 里的 Linux REA） |
| WASM（非 Linux 专属） | `REA_WABT_BIN_DIRECTORY=<wabt/bin> rea inspect-wasm-artifact <模块.wasm>` | WABT 1.0.42（Windows 上二进制要 `.exe` 后缀） | 真实 profile 验证于 macOS arm64 |

要点：Linux 上这些能力多数要求 **procps 兼容的 `ps` 在 PATH 上**（REA 启动子进程前要做属主检查）；缺了会在启动前拒绝，错误码可能是 `capability_unavailable` / `provider_unavailable` / `execution_failure` 之一。每个能力的完整契约见官方 `docs/` 下同名 guide（`firmware-analysis.md`、`signal-recordings.md`、`evm-bytecode.md`、`packet-captures.md`、`pcap-analysis.md`、`web-network-captures.md`、`wasm-artifacts.md`、`binary-diagnostics.md`）。

---

## 怎么知道某个能力在我这台机器上能不能用

### 1. `rea capabilities`：只回答"provider 操作"的可用性

```bash
rea capabilities --format json
rea providers --format json     # 同一份 catalog 身份摘要
```

【实测】它会按 provider 分组报告操作、`effects`、`available`、`reason`、`availability_code`，还会给出 `analysis_provider_candidates`（ghidra/hopper/ida 的 `not_configured` / `unsupported_host`）和 `server_identity`（包名、版本、CLI/MCP 工具计数）。

**它不报告零依赖能力**（【官方已说明这个区分】，但容易读漏）。`docs/cli.md` 原文："These commands describe binary-session providers and auxiliary capabilities. For the complete MCP surface, use the connected server's tool list"——**这句就是警告**，只是它出现在"Choose a provider"一节，找能力清单的人不会去那里读。在本机 6.5.0 上实测：输出里只有 `native-macos`（9 个操作，`unsupported_host`）、`rea-artifact-graph`（多数可用，`inspect_asset_catalog` 需 macOS `assetutil`）、`rea-dotnet-static`（3 个可用）、`sqlite`（Node 版本不合格时 `unsupported_version`），以及 ghidra/hopper/ida 三个候选。**静态 JS/Electron 分析、Go/Rust 检查、PE 资源、Electron fuses、网站观察都不在输出里——没列不等于不能用。**

常见 `availability_code` 的含义：

| 码 | 含义 |
| --- | --- |
| `unsupported_host` | 这台机器/系统不支持（如 Windows 上的 Hopper、非 macOS 的 Apple 工具） |
| `unsupported_version` | 前置版本不满足（如 SQLite 的 Node 门槛） |
| `not_configured` | 工具没装或没配环境变量（Ghidra/IDA/JADX 常见） |

### 2. `rea doctor`：报什么、不报什么

```bash
rea doctor --format json                          # 全量审计
rea doctor --provider ghidra --format json        # 只看一个引擎（6.8.0 接受 hopper|ghidra|ida|jadx|kuna）
rea doctor --client claude_code --format json     # 只看一个 agent 注册
rea doctor --target "<你的目标>" --format json     # 附加目标检查（仍是审计级报告，除非同时给 scope 选项）
```

【实测】全量 `doctor --format json` 给出：`scope_checks`（node 版本、host 平台，以及 hopper/ghidra/ida-registration/jadx 四个引擎检查 + 每个已检测 agent 的注册状态）、每项带 `classification`（`healthy` / `missing_analysis_engine` / `config_drift`）与 `remediation`、`providerInspections`（ghidra/ida/jadx 的 configured/available）、以及 `healthy` / `environment_healthy`。**注意**：审计级 `healthy: false` 完全可能只是"没装 Ghidra、有几个 client 没注册"——**不代表你选的工作流不可用**；用 `--provider` / `--client` 圈定你关心的范围再看退出码（选定的必需检查失败时退出 1）。另外实测：`doctor` **不接受 `--dry-run`**（那是 `setup` 的选项，会报 Unknown flag）。

### 3. 最可靠的判断：直接实测

零依赖能力没有预检——**跑一遍就是判断**。挑最小、最无害的真实目标：

| 想验证 | 拿什么目标试 | 一条命令 |
| --- | --- | --- |
| Electron/JS 分析 | 任意已装 Electron 应用的 `resources/app.asar` | `rea analyze-javascript-application "<asar>" --integrity-policy record-and-continue --filter-output evidence_id,normalized_result.statistics --format json` |
| .NET 分析 | 任意托管 dll/exe | `rea inspect-managed-artifact "<dll>" --format json` |
| Go 分析 | 任意 Go 写的 CLI（gh、docker…） | `rea inspect-go-binary "<它>" --format json` |
| Rust 分析 | 任意 Rust 写的程序 | `rea inspect-rust-binary "<它>" --format json` |
| PE 资源 | Windows 的 `notepad.exe`（其他平台拿任意 PE 文件） | `rea inspect-pe-resources "C:/Windows/System32/notepad.exe" --format json` |
| Electron fuses | Electron 应用主可执行文件 | `rea inspect-electron-fuses "<exe>" --format json` |
| 网站观察 | 自己起的 headless Chrome + 本地页面 | `rea list-browser-targets http://127.0.0.1:9222 --format json` |
| SQLite | 任意 `.sqlite` 文件 + Node 版本核对 | `rea capabilities --format json` 看 sqlite 组，再跑一次 `inspect-sqlite-database` |

对需要引擎/外部工具的能力，三级确认：

1. `rea doctor --provider <id> --format json` 看配置是否被认（会给出缺什么、怎么补）；
2. 补上环境变量后重跑 `doctor`，再看 `rea capabilities` 里该 provider 的 `available`；
3. 拿一个小的真实目标跑最小命令，确认 `coverage` 与 `limitations` 合理。

**最后看结果而不是只看退出码**：`0` 只说明"操作完成"。静态分析看 `coverage.status`（`complete` / `partial` / `unavailable`）与 `limitations`；原生分析看函数/引用是否被 `resolve`；任何 `unknown_facts` / `unavailable_facts` 都是显式的"不知道"，不是"不存在"。

<!-- 本页为第三方手册内容，非 REA 官方文档。命令行为以 REA 6.8.0 与官方 docs/ 为准。 -->
