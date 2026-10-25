# OpenCode 桌面版 —— 逆向分析

**目标**：`<OpenCode 安装目录>`
**版本**：0.1.18（Electron 应用）
**分析日期**：2026-10-15
**方法**：REA 静态应用重建 + 自写 ASAR/证据分析脚本（**未执行目标程序、未绕过任何技术保护措施**）

> **分析声明**：本分析基于**公开获取的软件发行包**（用户本机已安装副本），
> 使用**静态分析方法**，目的是学习其工程做法。报告中的代码片段为分析中**整理/重写的示意**，
> 不是原始代码副本；OpenCode 为开源项目，版权归其贡献者。
> 如果你是本报告分析对象的作者、对内容有异议，
> 请通过 [issue](https://github.com/sqkl520/rea-handbook/issues) 联系，我们会处理。

> **数字的来源**：下面所有图谱/IPC 计数都来自 REA 的 evidence 输出（`summary` 与
> `static_analysis.electron.ipc`），不是估算。已发布到仓库的只有追踪摘要
> （[`evidence/`](evidence/BASELINE.md)），完整 evidence 354 MB 没有入库。

---

## 这是什么

一个 **Electron 桌面应用**，`app.asar` 约 **146 MB**。

```bash
npm install --global rea-agents      # 先装工具
rea analyze-javascript-application "<路径>/app.asar" --integrity-policy record-and-continue --format json
# ⚠️ 必须加 --integrity-policy record-and-continue
#    否则会因 OpenConsole.exe 的声明哈希与实际字节不符而失败（打包时会二次签名，属正常）
# ⚠️ 输出是 354 MB，别直接读——用视图投影或 --filter-output
```

---

## 分析结果

### 规模

| 指标 | 数值 | 口径 |
| --- | --- | --- |
| 归档本身 | 146 MB | `app.asar` 本体 146,869,901 字节（140.1 MiB） |
| 归档内相关文件 | **6,702** | `relevant_files`——这 146 MB 里实际被纳入分析的文件数 |
| 解析的 JS 文件 | 4,489 | `parsed_javascript_files` |
| 应用图谱节点 | **27,278** | `traced_nodes` |
| 图谱边 | **32,977** | `traced_edges` |
| AST 节点 | 4,751,494 | `visited_ast_nodes` |
| 提取的发现 | 30,648 | `findings` |
| Evidence 体积 | 354 MB | **输出**体积，不是归档解压后的量 |

> **注意两个体积不是一回事**：146 MB 是输入（归档），354 MB 是输出（evidence JSON）。
> 后者比前者大是因为图谱把结构展开了，不是"解压后 354 MB"。

> **这条不是完整产出**：`graph.coverage.status = "partial"`。
> semantic 层撞了 100,000 节点的默认上限后截断，父进程结果预算 2,009,183,896 字节。
> 应用图谱层（节点/边/终端路径）是完整的，**semantic 层不是**。
> 要完整跑需要调高 `--max-semantic-nodes` 并留足堆——但那已经超出这份案例的范围。

### IPC 架构（最有价值的部分）

```
163 个 IPC 操作
 76 个字面量通道
 81 个主进程 handler（77 handle + 4 on）
 65 个 renderer invoke、77 个 main handle —— 两端各自的计数，不是配对数
 55 组配对（REA 的 summary.ipc.paired_renderer_transmissions）
 13 个 renderer 监听
 59 个暴露的 API 成员
```

> **65 和 77 不是配对结果**。它们是 renderer 侧和 main 侧各自的记录数；
> 真正配上的是 **55 组**——中间差的 10 个跨进程调用没有找到对端
> （可能走的是动态通道名，或者对端在未解析的模块里）。
> 早先这里用「65 ↔ 77」表示，容易被读成「配上了 65 对」，已改。

**跨进程链路可以精确闭环**——渲染进程侧 `invoke` 与主进程侧 `handle`
通过通道名精确配对，且**都带源码行列号**。

### 一个具体例子：`kill-sidecar` 通道

```
渲染进程侧：out/preload/index.js  第 11 行    invoke
主进程侧：  out/main/index.js     第 2069 行  handle（inline-function）
```

追踪它还发现了 **5 个原生插件交接点**（`@parcel/watcher`、`node-pty`、
`msgpackr-extract` 等 `.node` 文件）——这些地方静态分析到头了，
需要原生分析引擎才能继续。

### 一个子系统：WSL 服务器管理

```
14 个通道、41 条 IPC 记录
渲染侧：13 条 invoke + 2 条 on（`wsl-servers-event` 事件流）
主侧：26 条 handle（26/26，全部是 handle）
配一对 subscribe / unsubscribe 事件流
→ 一套设计规范的完整 API
```

> **值得往下推的一点**：26 条 main handler 只对应 14 个通道——每个通道在
> `out/main/index.js` 里注册了**两次**（一次 inline-function、一次 identifier 引用），
> 例如 `wsl-servers-get-state` 同时出现在第 3772 行和第 3827 行。
> 这说明主进程对业务 handler 有一层包装（先包一遍再注册），
> 而不是直接 `ipcMain.handle`。这一层包装是三份案例里最典型的"架构结论来自计数之外"的例子——
> 但本报告停在计数上，没有继续追。

### 打包配置画像（Electron fuses）

`inspect-electron-fuses` 秒级读出主程序里 9 个 fuse 开关的取值
（【实测】对 `OpenCode.exe`）：`RunAsNode: enabled`、
`EnableNodeCliInspectArguments: enabled`、`EnableEmbeddedAsarIntegrityValidation: disabled`、
`OnlyLoadAppFromAsar: disabled`（其余 5 个未列，报告以"记录状态"为目的，不作利用性判断）。
这组取值和 §"方法要点"里 `--integrity-policy` 遇到的实际状况相互印证：
应用允许运行时观察、但没有强制 asar 完整性校验。

---

## 方法要点

### 功能追踪的正确姿势

```bash
# seed kind 要用 "string"，不要用 "channel"
# 用 "channel" 会返回 no-match——它只匹配节点身份字段，
# 而通道名藏在 observations[].properties.static_analysis.electron.ipc[] 里
node build-trace-input.cjs <evidence.json> trace-input.json string kill-sidecar
rea trace-application-feature trace-input.json --format json
```

**结果**：命中 2 个种子 → 展开可达子图 27,278 节点 / 32,977 边 / 7,823 条终端路径。

### 大文件必须先投影

```bash
# 354 MB 的 evidence 不要用 readFileSync 整份读——这里是极限，
# 换成本仓库案例二那份 570 MB 就必崩（ERR_STRING_TOO_LONG，Node 单字符串上限 512 MiB）。
# 用 jq 流式投影，内存占用与文件大小无关：
jq -c '{source:{kind:"inline",evidence:.},view:{kind:"summary"}}' evidence.json > view.json
rea inspect-analysis-view view.json --format json
```

> 更早的版本这里给的是 `node -e "...readFileSync..."`。那样写在 354 MB 上勉强能跑，
> 但把「取决于目标大小」的经验当成了通用做法——同一段代码在 570 MB 上必崩。

---

## 目录内容

> 以下是**分析时的工作区**快照；evidence 等分析产物**不随本仓库发布**
> （脚本本身已收入仓库 [`tools/`](../tools/README.md)，可复用）。

```
tools/
  build-trace-input.cjs   ← 从保存的 evidence 构造追踪输入
  explore-evidence.cjs    ← 探查 evidence 结构（一次解析整份，几百 MB 以上别用）
  find-channels.cjs       ← 在 evidence 树里定位 IPC 通道数据

evidence/
  opencode-evidence.json  ← 354 MB 完整应用图谱
  trace-summary.json      ← kill-sidecar 追踪的紧凑摘要（4.8 KB）
  trace-wsl-summary.json  ← WSL 子系统追踪摘要
```

**`trace-summary.json` 是唯一值得长期保留的**——它记录了
"2 命中 / 27K 节点 / 5 个原生交接点"这个结论，而完整图谱可以随时重跑。

---

## 与其他项目的关系

这个分析练出的 **IPC 通道提取技巧**，后来用在了 ChatGPT 桌面版上
（见 [chatgpt-desktop.md](chatgpt-desktop.md)）——那边通道名不是字符串字面量而是集中式常量表
（`codex_desktop:*`），需要不同的提取方法。

**共同点**：两个 Electron 应用的分析都用到了
「先找 `ipcMain.handle` 的调用形态，再顺着找通道名」这个思路。
