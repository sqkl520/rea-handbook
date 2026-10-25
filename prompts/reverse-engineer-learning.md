# 逆向学习提示词（可复用模板）

> ⚠️ **仅对你有权分析的目标使用**（你自己的软件、开源项目、你购买并有权分析的产品）。
> 模板本身**不含**账号登录、授权/付费机制、密钥或隐私数据的分析步骤，也不产出可复现的绕过细节——
> 这些不在本手册范围内，遇到请跳过。
>
> **用法**：复制下面「提示词正文」整段，替换两个占位符，粘贴到任何有文件系统和命令行的 AI 对话框
> （Claude Code / Codex / Cursor / 其他 agent）。
>
> **本模板的来源**：它是从一次真实逆向（PCL2 启动器 2.13.1.1，643 个类型 / 6,116 个方法）
> 中提炼的——**包括踩过的坑和绕过的弯路**。照做能省几小时。

---

## 提示词正文（复制以下全部）

````text
# 任务：逆向分析一个应用，学习它的「<要学的功能>」，并把结论映射到我的项目

## 目标
- 应用路径：<填入绝对路径，如 D:\SomeApp\App.exe 或 /path/to/app.asar>
- 想学的功能：<填入，如"多版本管理""下载系统""UI 主题机制">
- 我的项目（用于最后映射）：<填入路径或简述；没有就写"无，只要通用分析">

## 工作原则（重要）

1. **静态优先，不执行目标程序**。除非我明确要求，否则不要运行它、不要加载它的代码。
   推论：**你看不到实际界面**。关于 UI 的一切只能从 XAML/BAML、样式资源、布局代码推断，
   结论一律标【推断】，不要写“界面很清爽”这类需要肉眼才能确认的判断。
2. **每条结论必须标注证据等级**：
   - 【观测】= 我直接看到了（源码、反汇编、字符串原文、文件偏移）
   - 【推断】= 我根据结构/命名/行为推断的
   不允许不标注就直接下结论。
3. **结论要具体到可验证**：类名、方法名、字符串原文、行号、偏移。
   不写"它用了多线程"，要写"`NetManagerClass.StartManager` 启动 3 个线程，
   命名为 `NetManager ThreadStarter 0/1`"。
4. **最后必须有一节「可借鉴性」**：明确回答"这个设计对我的项目意味着什么"，
   分成"可直接借鉴 / 需改造 / 不能照搬"三类，并说明理由。

## 阶段 0：侦察（先花 5 分钟搞清楚它是什么）

不要一上来就分析。先做类型识别，因为**不同技术的分析路径完全不同**：

| 特征 | 类型 | 主要路径 |
|---|---|---|
| PE 文件 + 有 `.NET` 元数据 | .NET 托管程序集 | 见 A 路线 |
| PE 文件 + 无托管元数据 | 原生二进制 | 需要 Ghidra/IDA（先问我有没有） |
| `.asar` 文件 或含 `resources/app` 的目录 | Electron/JS 应用 | 见 B 路线 |
| `.jar` / `.apk` | Java / Android | JADX（先确认工具可用） |
| 单文件含 `go build` 标记 | Go 二进制 | `inspect-go-binary` |
| 含 `.dep-v0` 段 | Rust 二进制 | `inspect-rust-binary` |
| 目录含 `package.json` + `index.html` | 网页应用 | 见 B 路线（静态部分） |

侦察命令示例（按实际情况选用）：
```bash
# 0. 先确认 REA 本身可用（不要跳过这步）
rea --version
rea doctor --format json    # healthy:false 是正常的；看具体哪项可用即可
#    没有 rea 命令 → 只能用 file / strings / ilspycmd 这类通用工具，
#    下面的 rea 命令一律跳过，别硬编造输出

# 文件类型
file <目标>        # 或看文件头前 64 字节
# .NET 判定：搜 "BSJB" 签名、看是否有 CLI header
# Electron 判定：看 resources/ 下有没有 app.asar
```

**规模预判**（决定要不要分 agent、要不要提前收窄输出）：

```bash
ls -lh <目标>       # > 150 MB 或 > 2000 个类型 → 先 --filter-output，别全量
```

**侦察完先向我汇报"这是什么 + 我打算走的路线"，再继续。**

## 阶段 1：分派分析路径

### A 路线：.NET 托管程序集

```bash
# 1. 确认身份（版本、框架、依赖、表行数）
rea inspect-managed-artifact "<目标>" --format json

# 2. ★ 先全量反编译（最有威力的一步，能一步拿到源码结构）
dotnet tool install --global ilspycmd   # 若未安装
ilspycmd -p -o <输出目录> "<目标>"       # -p = 整个项目，产出可读 C#/VB 源码
#    注意：反编译出的语言可能与原文不同（VB.NET 会变成 C#），结构仍准确
#    反编译成功就直接读源码，下面 3-4 步只在拿不到 ilspycmd 时才需要

# 3. 退路 A：REA 的逐类型提取（无反编译条件时用）
#    ⚠️ 不要直接跑全量成员提取！较大程序集会失败：
#       coverage.status = "unavailable"
#       Managed metadata exceeds the 67108864 byte representation budget
#    必须先知道类型全名，再逐个取：
rea inspect-managed-members "<目标>" --type <精确类型全名> --format json

# 4. 退路 B：类型全名怎么来（ilspycmd 不可用时）
#    (a) 写脚本直接解析 PE/CLI 元数据表（最可靠，见"复用工具"）
#    (b) PowerShell 反射（只读元数据，不加载代码）：
#        [System.Reflection.Assembly]::ReflectionOnlyLoadFrom("路径").GetTypes()

# 5. WPF 应用的额外一步：BAML → XAML
#    XAML 编译进程序集后是 BAML 二进制。用 .NET Framework 的
#    System.Windows.Baml2006.Baml2006Reader 可以解码成可读 XAML
```

### B 路线：Electron / JavaScript 应用

```bash
# 1. 先看 Electron 安全开关（秒级）
rea inspect-electron-fuses "<主可执行文件>" --format json

# 2. 静态重建（零依赖，不需要 Ghidra）
rea analyze-javascript-application "<asar或目录>" --format json > evidence.json

#    ⚠️ 如果报 artifact_integrity_mismatch：
#    这是因为它发现声明的哈希与实际字节不符（打包工具常会二次签名原生二进制）
#    加参数重跑，并接受"不可信"标记：
rea analyze-javascript-application "<路径>" --integrity-policy record-and-continue --format json > evidence.json

# 3. ⚠️ Evidence 可能有几百 MB，不要用 readFileSync 整份读！
#    Node 单字符串上限 512 MiB，超了直接 ERR_STRING_TOO_LONG。
#    先用 jq 流式投影，再把小结果交给 REA：
jq -c '{source:{kind:"inline",evidence:.},view:{kind:"summary"}}' evidence.json > view.json
rea inspect-analysis-view view.json --format json
#    更省的做法：分析时就收窄输出，别落地完整 evidence
#    rea analyze-javascript-application "<路径>" --filter-output '<只保留你要的路径>' --format json

# 4. 想直接看 asar 里的文件（不依赖 REA）：写个 ASAR 头解析脚本
#    asar 头部是 pickle 格式：
#      u32@0=4（标记）, u32@4=头部总长, u32@12=JSON长度
#      数据区偏移 = 8 + u32@4   ← 注意有对齐填充，不是 16+jsonLength
```

### 通用路线：字符串扫描（**任何类型都该做，产出/成本比最高**）

```bash
# .NET：字符串存在 #US 堆（UTF-16LE）。用 REA 的话：
rea inspect-managed-members "<目标>" --type <某类型> --format json
# 输出里的 user_strings 就是该类型用到的字符串字面量

# 不依赖 REA：写脚本扫二进制里的 UTF-16LE 可读串
# 关键：要按 UTF-16LE 解码（不是 ASCII），中文/URL 才出得来

# ★ 为什么这步最值：
#   成熟应用的日志文案是"自带文档"——你能从字符串直接读出工作流。
#   例：一个下载系统会留下 "分析支持库文件" → "下载支持库文件" →
#       "分析资源索引" → "下载资源索引" 这样的逐步文案，顺序即流程。
```

## 阶段 2：多 agent 并行（推荐，但按维度切分）

如果要开子 agent，**按"功能维度"切分，不要按"文件"切分**：

```
好的切分（各有独立结论）：
  · agent 1：<功能A> 的完整链路
  · agent 2：<功能B> 的完整链路
  · agent 3：UI / 呈现层
  · agent 4：错误处理与诊断
  · agent 5（可选）：与我的项目做对比

坏的切分（会互相重复、结论碎片化）：
  · agent 1：分析前 100 个文件
  · agent 2：分析后 100 个文件
```

给每个 agent 的任务书里**必须包含**：
1. 我已确认的**事实**（避免它重新发现，也避免它基于错误前提）
2. **证据等级要求**（【观测】/【推断】）
3. **可用的工具和解锁方式**（包括已知的坑，比如"全量提取会失败，用 --type"）
4. **它该产出什么格式**

## 阶段 3：交叉验证（**不要跳过**）

子 agent 会出错，我也会出错。**对关键的"类型/功能归属"结论，必须回到源码或反汇编核实**
——尤其是那种"按名字猜"的结论。

真实教训：曾按类型名把 `PageLinkMain` 当成"主页"，
实际它私有字段是 `NATType`/`NetworkSecret`，邀请码由 `GetInviteCode()` 现拼——是**联机页**；真正的主页是另一个类型。
**名字会骗人，字段和方法不会。**

验证方法：
```bash
# 拿到可疑类型后，看它的字段和方法名
rea inspect-managed-members "<目标>" --type <可疑类型> --format json
# 若已全量反编译，直接搜源码里的定义和使用点
```

## 阶段 4：输出格式

按这个结构产出（如果只想要简报，可以只出 ①③④）：

① **侦察结论**：这是什么技术栈、版本、规模（类型数/方法数/文件数）
② **完整报告**（Markdown）：按功能维度分章，每条结论带证据等级
③ **关键发现速览**：技术价值最高的 3-5 条 + 最意外的 3-5 条
④ **可借鉴性**（对我的项目）：可直接借鉴 / 需改造 / 不能照搬，各带理由
⑤ **证据资产**：原始提取文件（类型清单、字符串堆、反编译源码）放哪了
⑥ **复现指南**：我用了哪些命令，别人怎么重跑

## 已踩过的坑（照做省时间）

1. **全量成员提取会失败**（元数据超 64MB 预算）→ 必须 `--type` 逐个提。
2. **类型名要自己先解析出来**——靠 `AssemblyRef` 列表和元数据表，不要靠猜。
3. **大目标的 Evidence 是几百 MB**——用 `--filter-output` 或视图投影，别直接读。
4. **`--token-limit` 不能与结构化输出同用**（报 `UNSUPPORTED_OUTPUT_COMBINATION`），用 `--filter-output`。
5. **asar 完整性校验失败是正常的**（打包时会二次签名）→ `--integrity-policy record-and-continue`。
6. **在含 `"type": "module"` 的项目里写脚本要用 `.cjs` 后缀**，否则 `require` 报错。
7. **Git Bash 的 `/tmp` 与 Node 解析的路径不同**——混用时用 `cygpath -w` 或放项目内用相对路径。
8. **传 `/` 开头的参数给 Node 脚本时用 `MSYS_NO_PATHCONV=1`**，否则被转成 Windows 路径。
9. **调试字符串常泄漏源码路径**（`CallerFilePath` 特性）——搜 `E:\` 或 `/home/` 开头的串，
   能直接还原项目的目录结构，价值极高。
10. **反编译产物的语言可能与原文不同**（VB.NET → C#），命名和结构仍准确。

## 复用工具（如果当前环境没有，可以让我现场写）

- **PE/CLI 元数据解析器**：直接读 TypeDef/MethodDef/Field 表，拿全类型清单（绕开 64MB 限制）
- **#US 字符串堆解析器**：token `0x70xxxxxx` → UTF-16 文本（注意 offset 要 -1）
- **UTF-16LE 扫描器**：从任意二进制提取可读串
- **源码路径提取器**：从 `.text` 段还原泄漏的目录树
- **ASAR 头解析器**：列出归档结构、按需读文件

## 现在开始

先做阶段 0 侦察，向我汇报"这是什么 + 打算走的路线 + 预计会用到哪些工具"，等我确认后再深入。
每一步有重大发现时简短汇报一次，不要等全部做完才说。
````

---

## 精简版

**纯学习场景（不需要映射回自己项目）请用独立文件：
[`reverse-engineer-learning-minimal.md`](reverse-engineer-learning-minimal.md)**
——那份是当前维护版（"先给菜单"式流程）；本文件上方是完整版（含项目映射）。

> 注：本文件曾内嵌过一份旧版精简提示词，因与上面那份内容漂移，已移除。

---

## 使用示例（填好的样子）

```text
# 任务：逆向分析一个应用，学习它的「多版本管理与实例隔离」，并把结论映射到我的项目

## 目标
- 应用路径：<目标路径>（比如 D:\SomeApp\App.exe）
- 想学的功能：多版本管理、下载系统、UI 主题机制
- 我的项目（用于最后映射）：<你的项目路径>（简述是什么项目）

（其余照抄）
```

## 使用要点

**什么时候该用完整版，什么时候该精简**

| 场景 | 用哪部分 |
| --- | --- |
| 只想快速看懂某个机制 | 阶段 0 + 阶段 1 的字符串扫描，常常就够了 |
| 要写进自己项目 | 全流程，尤其不能省「交叉验证」和「可借鉴性」 |
| 目标很大（几百 MB / 几千个类型） | 必开多 agent，且**先做全量反编译**再做其他 |

**三个最容易省掉但最不该省的动作**

1. **阶段 0 的侦察**——跳过它会走错路线，浪费最多时间
2. **字符串扫描**——产出/成本比最高，且对任何技术栈都有效
3. **可借鉴性那一节**——不写它，这次分析就只是"了解了一个软件"，
   而不是"学到了能用的东西"

**如果分析对象是你有合法授权研究的目标**（自己的程序、开源软件、
你购买并有权分析的产品），这个流程完全适用。
动手前请自行确认目标的使用条款。

**卡住了去哪查**：这份模板只给流程，不列症状。遇到报错、结果看不懂、命令没输出，
查配套手册的 `guides/troubleshooting.md`（14 种症状逐条给解法）；不知道该用哪个命令，
查 `guides/by-target-type.md`。两者都在 <https://github.com/sqkl520/rea-handbook>。
