<!--
  疑难排查指南 —— REA 使用手册 / guides
  ============================================
  · 基于版本：REA 6.8.0（rea-agents@6.8.0）
  · 素材来源：官方文档（README.md、docs/*.md）与源码行为核验；
            三个真实分析项目（一个 .NET 桌面应用、两个 Electron 应用）的实战记录；
            本文涉及的大部分命令与错误信息均在本机实测复现
            （Windows 10 x64、Node 24.14.0、Git Bash）
  · 最后核对日期：2026-10-25
  · 标注约定：
      [官方已说明]  官方文档写了 → 这里告诉你去哪看、以及为什么还是容易踩
      [手册补充]    官方文档没写、或写了但容易误读 → 来自社区实测
  · 命令与行为以官方文档为准；若发现不一致，请以官方来源为权威。
-->

# 疑难排查指南

按**你看到的现象**组织，不按错误码——卡住的时候你往往只记得屏幕上那句话。

文中 `rea` 都可以替换为 `npx -y rea-agents@6.8.0`（免安装用法），行为相同。

> **基础原理**（输出格式、退出码语义、`filter-output`/`token-limit` 的完整规则）
> 在 [docs/01-getting-started.md 第 6 节](../docs/01-getting-started.md#6-输出怎么看)；
> 本页只讲症状与救急，两页互补。

---

## 症状：`Error: Cannot create a string longer than 0x1fffffe8 characters`

**你可能看到**：

```text
Error: Cannot create a string longer than 0x1fffffe8 characters
code: 'ERR_STRING_TOO_LONG'
```

当你（或你的脚本、你的 AI agent）用 Node 读一份几百 MB 的 evidence 文件时。

**为什么**：

这不是 REA 的限制，是 **V8 引擎的硬上限**：任何字符串最长 `0x1fffffe8`
= **512 MiB**。文件超过它，内存再大，`readFileSync(path,'utf8')` 与
`JSON.parse(整份字符串)` 都必然失败。

真实目标很容易越过这条线：146 MB 的 asar 产出 354 MB evidence（能读通），
567 MB 的 asar 产出 **570,218,269 字节**（必崩）——同一套脚本换个目标就崩，
最容易被误判为"偶发"。更麻烦的是官方材料里**同时有对的做法和会崩的做法**：
`docs/cli.md` 的投影示例用 `jq -c`（流式，可跑通）；`docs/javascript-application-workflows.md`
的追溯输入示例用 `node -e '...readFileSync...'`——**在 570 MB 上必崩**。

**[官方已说明]** 官方只说"完整 evidence 对真实应用可能几百 MB，要存文件再投影"，
**从未提到 512 MiB 这道硬墙**。

**怎么办**：

```bash
# ① 首选：jq 流式投影（570 MB 实测 30–100 秒，取决于机器和投影复杂度）
jq -c '{source:{kind:"inline",evidence:.},view:{kind:"summary"}}' \
  app-evidence.json > app-view.json
rea inspect-analysis-view app-view.json --format json

# ② 更省事：生成时就缩小
rea analyze-javascript-application "<asar>" \
  --format json --filter-output evidence_id,normalized_result.statistics
```

**能不能预防**：能——**先 `ls -lh` 看大小再决定怎么读**（超 500 MB 不用
`readFileSync`）；让 AI agent 处理大 evidence 时**在指令里写死"用 jq，
不要用 node readFileSync"**；生成阶段就用 `--filter-output` 压掉无关字段。

---

## 症状：`UNSUPPORTED_OUTPUT_COMBINATION`（想限制输出 token 却报错）

**你可能看到**：

```json
{"ok":false,"error":{"code":"UNSUPPORTED_OUTPUT_COMBINATION",
"message":"Token windows cannot preserve structured output. Remove --token-limit/--token-offset and use --filter-output or command pagination."}}
```

**为什么**：

`--token-limit` / `--token-offset` 是给人类阅读的窗口，切片后 JSON 结构不再完整，
所以与 `json` / `jsonl` / `yaml` 互斥（实测：这两个格式都报错，默认 `toon` 通过）。

**[手册补充]** 报错消息本身很友好，但**`--token-limit` 在官方文档里几乎没有记录**
——`grep -rn "token-limit" docs/` 零结果。你有这个选项可用，只能靠 `--help`
或报错消息发现它（文档只提过 `--token-count`）。

**怎么办**：

```bash
# 要"缩小输出"就用 --filter-output 或分页参数，不要用 --token-limit
rea analyze-javascript-application "<asar>" --format json \
  --filter-output evidence_id,normalized_result.statistics
rea inspect-sqlite-database db.sqlite --table ItemTable --row-limit 15 --format json
```

**能不能预防**：能——**看到"缩小输出"的需求，默认想 `--filter-output`**。
`--token-limit` 只用于在终端里翻页看文本报告。

---

## 症状：`coverage.state = "partial"`，元数据超 64 MiB 预算（.NET）

**你可能看到**（6.8.0）：

```json
"coverage": {"state": "partial", "issues": [{
  "code": "resource-limit", "scope": "metadata.representation", "offset": 564775,
  "detail": "Managed metadata exceeds the 67108864 byte representation budget"}]}
```

**类型清单是全的，成员是空的。** `metadata.status` 也是 `partial`，
`limitations` 里写着 "Member decoding exceeded capacity after the type inventory
was admitted; fields, methods, member references, call edges, field accesses,
exported types and user strings are not examined to completion."

**注意退出码是 0**——只看退出码会误以为"这个程序集没有成员"。

> **6.5.0 上的表现不同**：那时是 `state: "unavailable"`、`types: 0`——连类型清单都拿不到。
> 6.8.0 新增了 `ManagedMemberRecovery`，把"整份失败"降级成"清单保留、成员缺失"。
> 如果你在 6.5.0 上看到 `unavailable`，是版本差异，不是配置问题。

**为什么**：

REA 对 .NET 元数据 / CIL 解码 / 投影有**独立的 64 MiB 表示预算**
（`67108864` 字节），是刻意的资源策略，不是 PE 格式限制。实测：3.4 MB 的
`System.dll` 就会撑爆——它有 **2,365 个 TypeDef、18,170 个方法**，
全量展开远超 64 MiB（对照：PCL2 那种 643 个类型的小程序集反而更接近边界）。

**[官方已说明]** 官方 `docs/managed-code-analysis.md` 的 Resource admission 一节写明了这个预算，
并明确它 "not PE format limits"。

**怎么办**：

```bash
# 6.8.0：先全量跑一次，从结果里拿类型清单（成员会是空的，但清单完整）
rea inspect-managed-members "C:/path/to/Your.dll" --format json \
  | jq -r '.types[].full_name' > types.txt

# 再逐个类型提取（这次 coverage 为 complete，成员齐全）
rea inspect-managed-members "C:/path/to/Your.dll" --type Your.Full.Type.Name --format json
```

类型多了就循环：

```bash
for T in $(cat types.txt); do
  rea inspect-managed-members "C:/path/to/Your.dll" --type "$T" --format json \
    > "out/$(echo "$T" | tr '.' '_').json"
done
```

**在 6.5.0 上**（拿不到清单时）才需要先靠外部手段取类型名：

```bash
# 只反射、不执行
powershell -Command "[System.Reflection.Assembly]::ReflectionOnlyLoadFrom('C:\path\to\Your.dll').GetTypes() | ForEach-Object { \$_.FullName }"
# 或直接全量反编译（REA 之外的第三方工具）
ilspycmd -p -o ./decompiled "C:/path/to/Your.dll"
```

**能不能预防**：能——**提完检查 `selection.unmatched_type_names`**：
类型名写错时 REA 不会报错，而是把名字放进这个字段并继续（见下方「`--filter-output` **静默**返回 `{}`」一节）。

---

## 症状：`The parent's result capacity was exhausted...`（大目标分析中断）

**你可能看到**：

```text
The parent's result capacity was exhausted after retaining static facts for
webview/assets/examples-48ad3573ed8e.js; remaining sources were not analyzed
```

以及分系列消息：`The parent reserved its remaining result capacity for static
observations; semantic analysis of <file> was not started`。

**为什么**：

静态 JS 分析是"父进程 + 独立 worker"结构。父进程的结果预算（源码实证）：

```text
resultBudget = (父进程 V8 堆上限 - 已用堆 - 24 × 8 MiB) / 2
```

这是**按父进程堆**算的。实测典型值：570 MB evidence 对应
`parent_result_budget_bytes` 约 **1.9 GB**。预算吃满即停，已分析部分完整保留，
其余明确标注未分析。

两个关键推论：

- `--max-semantic-nodes` 之类的语义参数**帮不上忙**（官方原文：
  "Raising these controls does not bypass worker heap, execution deadline or
  parent result admission"）。
- **调 `NODE_OPTIONS` 有效**——它控制 CLI/MCP 进程（"父进程"）的堆。
  worker 不受它影响：REA 启动 worker 时主动剥掉继承的 `NODE_OPTIONS`
  （单独传 `--max-old-space-size`），所以这个杠杆只作用于父进程——
  而父进程恰好是这里的瓶颈。

**[官方已说明]** 官方写了容量耗尽会停止并保留未知范围，也提供了
`--max-heap-mb` / `--analysis-timeout-ms`（默认 1024 MiB / 300000 ms）。
**[手册补充]** 但"预算公式在父进程、扩大它要靠 `NODE_OPTIONS`"这层没讲；
两个杠杆（`--max-heap-mb` 管 worker、`NODE_OPTIONS` 管父进程）在文档里
分开写，很容易调错。实测确认：同一份输入，父进程堆 2048 报容量不足、6144 通过。

**怎么办**：

```bash
# ① 调大 worker 堆与超时（官方正路，缓解 worker 侧失败）
rea analyze-javascript-application "<asar>" \
  --max-heap-mb 4096 --analysis-timeout-ms 600000 --format json > evidence.json

# ② 针对父进程容量：调大父进程堆
NODE_OPTIONS="--max-old-space-size=8192" rea analyze-javascript-application \
  "<asar>" --format json > evidence.json

# ③ 分层喂：只分析关心的子集（--source-path 可重复）
rea analyze-javascript-application "<asar>" \
  --source-path "webview/apps" --source-path "out/main" --format json > evidence.json
```

不能重跑时：接受部分结果，把 `coverage.status = "partial"` 与未知清单
完整记录下来——REA 把未知**显式计数**，这本身就是有价值的产出。

**能不能预防**：部分能——对超过 ~150 MB 的 asar 预先调高父进程堆，
并考虑先 `--source-path` 分层；在空闲内存充裕的机器上跑
（父进程堆 + worker 堆 + 结果副本会叠加）。

---

## 症状：`artifact_integrity_mismatch`，指认某个 `.node` / `OpenConsole.exe`（**这通常是正常的**）

**你可能看到**：

```json
{"code": "artifact_integrity_mismatch",
 "details": {"logical_path": "node_modules/.../OpenConsole.exe",
   "declared_sha256": "...", "calculated_sha256": "...", "unpacked": true}}
```

或结果里的 `integrity_contradictions` 数组与 `trust: "observed-untrusted"`。

**为什么**：

`.asar` 头部记录每个文件的 SHA-256，但打包工具**常常在写完归档头之后，
再对 `.asar.unpacked` 里的原生二进制二次签名或剥离**——于是哈希对不上。
**Electron 运行时自己也不检查**这些哈希，所以这不是应用坏了。

**[官方已说明]** 官方明确写了成因与定性（"Packaging tools commonly sign or
strip... Electron does not check unpacked companions against those hashes at
runtime"，`docs/mcp-contracts.md`）。REA 默认 `--integrity-policy fail`：
宁可停下也不静默接受可疑字节。

**怎么办**：

```bash
rea analyze-javascript-application "<asar>" \
  --integrity-policy record-and-continue --format json > evidence.json
```

继续是"记下并跳过"而不是"当作没问题"：冲突保留在 `integrity_contradictions`
（含 declared / observed 哈希），受影响条目标记 `trust: observed-untrusted`，
被指认的嵌套归档不展开。

**能不能预防**：能——**分析"已发布的 Electron 应用"就默认带上
`--integrity-policy record-and-continue`**。反过来，如果你在做完整性验证
（要证明文件没被改过），保留默认 `fail`。

---

## 症状：`trace-application-feature` 返回 **no-match**（种子明明在应用里）

**你可能看到**：

```json
"coverage": {"status": "no-match", "source_graph_status": "partial", "total_seed_matches": 0}
```

以及：`No graph entity matched the literal seed; this is not evidence that
the feature is absent.`

**为什么**：

**这是本手册最值得记住的一条。** 官方文档列出的合法 seed kind 里包含
"IPC channel"，但**这个选项在实战中很可能匹配不到任何东西**。

原因（已核验 6.8.0 源码）：`kind:"channel"` 只匹配**节点身份**
——要求图谱里存在 `kind` 恰为 `ipc-channel` 的节点；而你真正要找的通道名
通常住在某个 `javascript-asset` 节点的
`observations[].properties.static_analysis.electron.ipc[].channel` 里。

> **什么时候会遇到**：分析正常展开时，图谱里是有真正的 `ipc-channel` 节点的，`channel` 能匹配。
> 但在**投影失败**（`application_projection_failure`，通常是父进程结果预算耗尽）时，
> 结构化的 `ipc-channel` 节点不会生成，通道信息只剩文件节点上那份
> `static_analysis.electron.ipc[]`。这时 `channel` 必然搜不到，`string` 能。
> 换句话说：**`channel` 的失效与"分析是否完整"绑定**——看到 `status: partial`
> 就应该直接用 `string`。

同一份 evidence 的对照实验（实测）：

| seed | 结果 |
| --- | --- |
| `{kind:"channel", value:"kill-sidecar"}` | **0 命中**，`status:"no-match"` |
| `{kind:"string", value:"kill-sidecar"}` | **2 命中**（字段为 `...electron.call_paths[20].channel` 与 `...electron.ipc[0].channel`） |

**[官方已说明]** 官方列出了 seed kind（"node ID, route, string, API,
IPC channel, module, or native export"）。
**[手册补充]** 官方文档与源码行为在 `channel` 这一项上存在落差。
**拿通道名做种子时，先用 `string`。**

**怎么办**：

```bash
node -e 'const fs=require("fs");
const application=JSON.parse(fs.readFileSync("app-evidence.json","utf8"));
fs.writeFileSync("trace-input.json", JSON.stringify({
  application, seed: { kind: "string", value: "kill-sidecar" }, direction: "both" }));'
rea trace-application-feature trace-input.json --format json
```

（文件大的话先按第一节处理 512 MiB 问题。）

**能不能预防**：能——**seed kind 一律先用 `string`**。另外看结果里的
`source_graph_status`：为 `partial` 时，没匹配到可能只是因为相关文件没被分析，
这与"功能不存在"是两回事。

---

## 症状：通道名 / 字符串在主 bundle 里搜不到（正则全部落空）

**你可能看到**：

在你确定功能存在的文件里，搜索通道名一条都搜不到。

**为什么**：

现代打包会把字符串**集中到常量表**，用命名空间前缀拼接。实测的两种形态：

1. **集中式常量表**：主 bundle 里只有 `_.ipcMain.handle(g.St, ...)`，
   `g.St` 指向另一个模块里的 `` St = `codex_desktop:message-from-view` ``；
2. **动态拼接**：`` `codex_desktop:worker:${e}:from-view` ``，静态只能搜到前缀。

对照：有些应用通道名就是字面量，**直接就能搜到**——搜不到不代表方法错了，
每个应用打包习惯不同。

**怎么办**：

```bash
# ① 在主 bundle 里找模块绑定名
grep -o 'require("\./bootstrap-[^"]*")' app-initial.js | head
# ② 到那个模块里搜反引号字符串
grep -o '`[a-zA-Z_]*_desktop:[a-zA-Z:-]*`' bootstrap-*.js | sort -u
# ③ 用候选通道名做 string seed 验证
```

本次在 567 MB 应用上用这套三步法提出 **23 个**通道，而最初的正则命中为 0；
对照的 146 MB 应用通道名是字面量，简单正则直接命中 76 个。

**能不能预防**：能——**先侦察再写正则**：拿一个确定存在的通道名做灵敏度测试；
先提模块绑定再顺藤摸瓜找定义；并与 REA 图谱交叉验证
（动态通道会被标 `resolution: "dynamic"`）。

---

## 症状：`--filter-output` **静默**返回 `{}`（不报错）

**你可能看到**：`{}` —— 退出码 0，stderr 干净。

**为什么**：

`--filter-output` 是**字段路径**选择器（逗号分隔，如 `a,b.c,d[0,3]`），
不是 JSONPath。实测的静默行为：

| 输入 | 结果 | 退出码 |
| --- | --- | --- |
| 不存在的字段 `zzz_nope` | `{}` | **0** |
| 嵌套路径不存在 `normalized_result.statistics` | `{"normalized_result":{}}` | **0** |
| 只有未闭合的 `[`（`a,b.c,d[0,3`） | 报 `INVALID_OUTPUT_FILTER` | 1 |

这特别危险：**"过滤对了"和"过滤的字段根本不存在"看起来完全一样**。
尤其容易中招：把 JS 分析才有的字段名（如 `normalized_result.statistics`）
用在别的命令上，得到 `{"normalized_result":{}}`——看起来"这个命令就是没这字段"，
实际是选择器没匹配上。

**[官方已说明]** 官方给了过滤示例；**[手册补充]** 从未提
"字段路径写错时静默返回空"（未闭合 `[` 会被拒绝，字段名写错仍静默）。

**怎么办**：

```bash
# 先看一次完整输出的顶层结构，抄真实字段名，再写过滤
rea <command> <target> --format json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const o=JSON.parse(s); console.log(Object.keys(o).join("\n"));});'
```

**能不能预防**：能——**过滤结果永远先检查是不是空**：

```bash
OUT=$(rea ... --filter-output "evidence_id"); [ "$OUT" = "{}" ] && echo "FILTER MISSED" && exit 1
```

调试期先不带 `--filter-output` 跑一次确认字段名，再优化体积。

### 6.8.0 的三条新行为（与上表不同）

**① 失败结果不再被 filter 吃掉。** 6.5.0/6.7.0 里，命令失败时 `--filter-output code`
可能只剩 `"target_unavailable"`、写错字段给 `{}`——把错误信息本身滤没了。
6.8.0 改成**忽略 filter、返回完整错误对象**。

**② 不健康的 `doctor` 完全无视 `--filter-output`。** 这条最容易让人误判：

```bash
rea doctor --json --filter-output zz    # healthy:false 的机器上照样返回全量 ~13 KB
```

因为 `healthy: false` 被判为失败，走了上面的"失败不滤"分支。
**看起来像 filter 彻底失效，其实是设计**。机器健康时 filter 正常生效。

**③ 新的错误码。** 以前这些情况报 `UNKNOWN` 或静默，现在有明确代码：

| 情况 | 6.8.0 |
| --- | --- |
| `--filter-output` 给了标志但没给值 | `MISSING_OUTPUT_VALUE` |
| `--format bogus`、`--token-limit -3` | `INVALID_OUTPUT_VALUE` |
| `--format jsonl` 用在非行集合结果上 | `unreadable_output` |

---

## 症状：SQLite 报 `unsupported_version`，但别的命令都好用

**你可能看到**：

```json
{"available": false, "availability_code": "unsupported_version",
 "reason": "SQLite inspection requires Node.js 24.x >=24.15 or 26+ with the native DatabaseSync.limits API. Other REA features retain their published runtime requirements."}
```

**为什么**：

REA **6.8.0** 的整体 Node 要求是 `^22.23.4 || ^24.22.1 || >=26.12.1`；
而 **SQLite 的独立门槛没跟着抬：24.x 必须 >=24.15，或 26+**。
两条约束交叉后会出现**两段死区**——SQLite 够格但 REA 装不上：

```text
Node 24.15 ~ 24.21  →  SQLite ✅  整体 ❌（< 24.22.1）   ← 死区①
Node 26.0  ~ 26.11  →  SQLite ✅  整体 ❌（< 26.12.1）   ← 死区②
```

这两段最坑：你按 SQLite 的文档升到了 24.15，结果 `npm install -g rea-agents`
直接报 `EBADENGINE`。看起来"够新了"，实际连装都装不上。

另有一段是**能装但 SQLite 不可用**：

```text
Node 22.23.4 ~ 22.x  →  整体 ✅  SQLite ❌
```

这段的用户会遇到"其它都正常、只有 SQLite 报错、且报错说的是版本"这种
最容易归因错误的组合。

**[官方已说明]** 官方 `docs/sqlite-databases.md` 写了门槛；
**[手册补充]** 但官方的 Node 版本文档只写了 `^22.19 || ^24.11 || >=26`，
这个 SQLite 例外只出现在能力表的末尾一行（`README.md` 的 "SQLite databases" 行），
很容易漏读。

**怎么办**：

```bash
# 不动系统 Node：单独下载满足门槛的 Node，用绝对路径调用
N24="/path/to/node-24.22.1/node"
REA_JS="/path/to/npm-global/node_modules/rea-agents/scripts/rea.mjs"
"$N24" "$REA_JS" inspect-sqlite-database ./data.db \
  --table ItemTable --column key --row-limit 15 --format json
```

**能不能预防**：能——先 `node --version` 对两个门槛：

| 你的 Node | 整体（6.8.0） | SQLite | 备注 |
| --- | --- | --- | --- |
| `< 22.23.4` | ❌ | ❌ | 装不上 |
| 22.23.4 ~ 22.x | ✅ | ❌ | 能装，SQLite 不可用 |
| 24.11 ~ 24.14 | ❌ | ❌ | 装不上 |
| **24.15 ~ 24.21** | ❌ | ✅ | **死区：SQLite 够格但装不上** |
| **24.22.1 ~ 24.x** | ✅ | ✅ | 推荐 |
| **26.0 ~ 26.11** | ❌ | ✅ | **死区：SQLite 够格但装不上** |
| `>= 26.12.1` | ✅ | ✅ | 推荐 |

**一条命令避开所有坑**：直接用 **24.22.1+** 或 **26.12.1+**。

---

## 症状：旧版存的 evidence，新版读不了（`evidence_integrity_mismatch`）

**你可能看到**：把 6.5.0 时期保存的 `evidence.json` 喂给 6.8.0 的命令，
报 `evidence_integrity_mismatch`，说证据的 schema 与当前版本不符。

**为什么**：evidence 里带 schema 标识，6.8.0 改了（新增了 `ManagedMemberRecovery`
等结构）。**跨版本复用 evidence 不受支持**——它不像 JSON 那样向后兼容。

**怎么办**：

- 想复用就**用同一个版本重跑**生成 evidence。升级过的机器上，旧的 evidence 只能作参考，
  不能当输入。
- 长期保存证据时，把生成它的 REA 版本一起记下来（`rea --version`），
  下次就知道要不要重跑。

**能不能预防**：能——**分析产物和工具版本绑定保存**。本仓库的
`case-studies/evidence/` 就是这么做的：摘要文件头写明了分析时的版本（6.5.0 时期），
所以它们只用于核对历史数字，不会被当成 6.8.0 的输入。

---

## 症状：路径/参数在 Windows 上被改写（Git Bash / MSYS）

**你可能看到**：

- 传给子进程的 `--dir:/webview/apps` 变成 `--dir:C:/Program Files/Git/webview/apps`；
- Node 收到的 `/tmp/foo.json` 解析成 `D:\tmp\foo.json`（Git Bash 的 `/tmp`
  实际在 `%LOCALAPPDATA%\Temp`，可用 `cygpath -w /tmp` 验证）；
- `node -e "...require('/tmp/x.json')..."` 报 `Cannot find module 'C:Users...'`。

**为什么**：

Git Bash（MSYS2）会把以 `/` 开头的参数当 POSIX 路径转换成 Windows 路径，
即使它根本不是路径。另外反斜杠在 `node -e` 的内嵌字符串里还可能被吃掉
（实测出现 `C:UsersYourName~1AppData...` 这种斜杠全消失的形态）。

**[手册补充]** 这是 Git Bash 行为，与 REA 无关；官方文档默认 POSIX shell
环境，这类问题在官方文档里没有覆盖。

**怎么办**：

```bash
WINPATH=$(cygpath -w /tmp/foo.json)                 # ① 转换真实路径
MSYS_NO_PATHCONV=1 node script.cjs --dir:/webview/apps   # ② 关掉参数转换
cd ./my-analysis && jq -c '{...}' ./app-evidence.json > ./view.json  # ③ 别用 /tmp，用相对路径
node -e "require('C:/path/to/x.json')"              # ④ node -e 里用正斜杠，别用反斜杠
```

**能不能预防**：能——Windows + Git Bash 用户养成两条习惯：
**中间产物放当前工作目录、用相对路径引用**；传给子进程的路径，
不确定就先 `cygpath -w` 打出来看一眼。（`rea` 本身对 Windows 原生路径
处理正常——出问题的永远是 shell 与子进程的边界。）

---

## 症状：`require` 报错 / 脚本跑不起来（ESM 仓库里写 CommonJS）

**你可能看到**：

```text
ReferenceError: require is not defined in ES module scope
```
或 `Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported`

**为什么**：

REA 6.8.0 的 `package.json` 有 `"type": "module"`，整个包是 ESM。
脚本在这棵目录树里用 `require(...)` 写就会撞上。[手册补充] 这是 JS 通识，
但因为"跟着 REA 的目录结构放脚本"很自然，踩到的人不少。

**怎么办**：

```bash
mv my-script.js my-script.cjs   # .cjs 让 Node 明确按 CommonJS 解析
node my-script.cjs
```

**能不能预防**：能——**在 ESM 仓库里写辅助脚本，一律用 `.cjs` 后缀**，
无论内容多简单。加进你的模板，一辈子不会再遇到。

---

## 症状：分析结果看起来"完全不对"（功能全为假 / 全为空）

**你可能看到**：

探针报告某功能"不存在"、某 API"没有使用"——结论整齐得可疑。

**为什么**：

最常见的原因是**探错了文件**。真实应用里同名或近名的入口文件很多，
大小可能天差地别。实测案例：某 `app-main-*.js` **只有 497 字节**，
是个转发 stub；真正的代码在另一个 10.9 MB 的文件里。按文件名猜"main 就是
主逻辑"，搜索全落空——结论完全错误，且没有任何报错。

**怎么办**：

```bash
ls -laS <目录>/*.js | head -20   # 按体积排序，找出真正的大文件
head -20 app-main-*.js           # stub 通常只有几行 require/export
```

结论出来后**回到文件本身复核**：关键结论依赖的那个文件，是不是你要分析的那个。

**能不能预防**：能——**先看大小再看文件名**（入口转发 stub 极其普遍）；
**对"阴性结论"保持怀疑**（搜索无结果与"功能不存在"之间隔着好几种可能）；
让子任务输出结论时**带上文件路径与大小**，方便一眼识别 497 字节的 stub。

---

## 症状：类型名 / 功能归属判断错了（`PageLinkMain` 类）

**你可能看到**：

报告说"`PageLinkMain` 是主页类"、"`MySkin` 是主题引擎"，但你越看越不对劲。

**为什么**：

真实教训（.NET WPF 应用），按名字推断的全错：

| 名字看起来像 | 实际是什么 |
| --- | --- |
| `PageLinkMain`——"主页" | **联机页**：私有字段 `NATType` / `NetworkSecret`，邀请码由 `GetInviteCode()` 现拼 |
| `MySkin`——"皮肤/主题引擎" | **Minecraft 皮肤预览控件**（`_ImgBack`/`_ImgFore`，40 个方法） |

真正的主页是 `PageLaunchRight`；主题机制藏在别处（是算法而不是一个叫 Skin 的类）。

**[官方已说明]** REA 有相关严谨性设计（`authority` 区分 observed 与
static-relationship-inference、显式统计 `unknown_facts`，见 `docs/javascript-application-graph.md`）；
**[手册补充]** 但**没有任何机制
能防止人类或 AI"看着类型名猜功能"**。

**怎么办**：交叉验证，不看名字看证据——拿 `inspect-managed-members` 的
`--type` 输出，重点看：**字段名与类型**（`NATType` 一出就知道跟联机相关）、
**CIL 字符串字面量**、**方法名与调用关系**。对关键归属结论，需要两个以上
独立证据源一致。

**能不能预防**：**能，这是全节最重要的一条预防措施**——**名字是假设，不是证据**。
任何"看起来像……"的结论，下结论前必须被字段名、方法实现、字符串字面量中的
至少一个交叉验证过。如果你让 AI 做分析：在任务书里明确要求"每个功能归属
结论必须附交叉验证证据，不接受仅凭命名的推断"（子 agent 会错，主 agent 也会错）。

---

## 症状：反编译出来的语言和原文不一样（VB.NET 变 C#）

**你可能看到**：VB.NET 应用反编译出来是 C# 语法。

**为什么**：

这不是 REA 的行为——REA **不做反编译**，它的 .NET 能力是元数据 / CIL 级静态
检查。反编译是你的另一个工具（通常 ILSpy / `ilspycmd`）做的：命名和结构准确，
语法按目标语言习惯走。**[手册补充]** 官方只在验证链里提 ILSpy
（作为可选 oracle），不教用它做逆向。

**怎么办**：把反编译产物当**结构地图**读——命名、类型关系、方法签名、
控制流是准的；语法细节、糖（默认参数、事件绑定）可能不同，别据此下
语法层面的结论。需要精确语法就回到 CIL 层面核对。

**能不能预防**：能——**在分析任务书里先声明"反编译产物语言可能与原文不同"**，
避免自己和协作者把它当逐字源码引用。学设计学思路，不学语法。

---

# 怎么判断是"我的问题"还是"工具的问题"

先跑这三个自查（成本都很低）：

```bash
rea doctor --format json          # 环境与就绪状态
rea mcp doctor --format json      # REA 服务器自检（agent 场景）
rea capabilities --format json    # 能力与提供方清单
```

怎么读：

| 检查 | 健康的样子 | 注意 |
| --- | --- | --- |
| `rea doctor` | `node` / `host` 为 `ok:true` | **`healthy:false` 不代表坏了**——provider（Hopper/Ghidra/IDA/JADX）缺席或没注册 agent 都会让它 false。实测环境 `healthy:false` 但零依赖功能全部可用。**看具体哪一项失败，别看总布尔值。** |
| `rea doctor` 退出码 | 选定范围的必需检查通过 → 0 | 引擎缺失/未注册 agent → **1** |
| `rea mcp doctor` | `healthy:true`，`inventory` 的 expected == observed | 判断"REA 自身是否正常"最干净的信号（实测：207 工具 / 6 提示全就位） |
| `rea capabilities` | 各操作组有 `available` | **它只报告"需要 provider 的操作"**——见下 |

## `rea capabilities` 不是完整能力清单

官方文档没有显式警告、但必须知道的区分：**`capabilities` 只列出"需要外部
provider 的操作"，零依赖能力不在其中**——包括最常用的：静态 JS/Electron 分析、
.NET 元数据检查、Go/Rust 检查、网站被动观察、Electron fuses 检查。它们照常可用。

**[手册补充]** 拿它当"这台机器能做什么"的完整清单会严重偏低
（实测：它报 8 个可用 + 11 个不可用，而实际跑通的能力远多于此）。

`available:false` 读 `availability_code`：`unsupported_host`（平台不支持，
如 macOS 专属工具）／ `unsupported_version`（运行时版本不够，如 SQLite 门槛）／
`missing_analysis_engine`（Hopper/Ghidra/IDA/JADX 没装，只影响原生分析）。

## 退出码 0 **不代表完全成功**

[官方已说明] 退出码 0 只表示"操作完成了"——**结果里可能包含部分证据、
警告或未解决问题**。本文实测的两个例子：

1. `inspect-managed-members` 元数据超预算：退出码 0，但
   `coverage.state = "unavailable"`（**.NET 域用 `state`**）；
2. 大目标分析容量耗尽：退出码 0，有完整输出，但 `coverage.status = "partial"`
   且带明确的未分析清单（**JavaScript / 图谱域用 `status`**）。

所以每次都看这几个字段，不要只看退出码：

```text
coverage.state                       .NET 域（managed）：complete / partial / unavailable
coverage.status                      JS / 图谱域：complete / partial / unavailable / no-match
unknown_facts / unavailable_facts    未知与不可用事实的显式计数
issues[]                             resource-limit 等明确问题
limitations[]                        工具自己声明的局限
```

退出码完整语义：`0` 完成（可能部分）；`1` 无法完成；`128+N` 被信号 N 终止。
写脚本时加 `set -o pipefail`，避免下游格式化工具吞掉失败状态。

## 进度在哪里？——stdout / stderr 分工

- **stdout**：只放最终结果文档（可以安全 `> result.json`）；
- **stderr**：进度与交互提示；静态 JS 分析输出 `rea_progress` JSON 行。

```bash
rea analyze-javascript-application "<asar>" --format json > evidence.json 2>progress.log
```

---

# 如果这些都没解决

## 先做一次"最小复现"

1. **换一个简单目标**试同一命令（如 `notepad.exe` 试 PE 相关命令）。
   简单目标能用 → 问题在你的目标或规模上。
2. **去掉花哨参数**（`--filter-output` / `--integrity-policy` / `--token-*`），
   只留目标 + `--format json`；能跑就逐个加回来定位。
3. **换最干净的调用**：`npx -y rea-agents@6.8.0 <命令>`（排除安装损坏）。
4. **跑 `rea mcp doctor`** 看 REA 自身是否完好。

## 报告问题时该提供什么

```text
1. REA 版本             rea --version（或 pin 的版本号）
2. Node 版本            node --version（注意 SQLite 双门槛）
3. 操作系统与架构        Windows 10 x64 / macOS 14 arm64 / ...
4. 目标类型与规模        应用类型 + 目标大小（asar / 程序集多少 MB）
5. 完整命令             一字不差，含所有参数
6. 完整输出与错误        stderr + stdout 都要；大输出截取头尾各几十行
7. 已做过的排除动作      换过简单目标/版本？跑过 doctor？
8. 最小复现步骤         能稳定重现的顺序
```

## 去哪里问

| 渠道 | 适合什么 |
| --- | --- |
| **GitHub Issues**（`morluto/rea` 仓库） | 确凿的 bug、崩溃、文档补充。官方 README 给出应附要素：REA 版本、目标类型、复现步骤、错误输出 |
| **Discord**（README 徽章里的邀请链接） | 使用问题、Q&A、分享案例 |
| **先更新再报告** | 官方建议先 `rea update`（或 `npx rea-agents@latest setup` 后重启 agent）——最新版本可能已修复 |

报告前顺手确认：**你的问题是不是本文档前面某一条**。相当一部分"bug"其实是
**部分成功**被读成失败（看 `coverage` 字段），或**静默过滤**被读成成功。
