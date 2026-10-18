# OpenCode 桌面版 —— 逆向分析

**目标**：`<OpenCode 安装目录>`
**版本**：0.1.18（Electron 应用）
**分析日期**：2026-10-15
**方法**：REA 静态应用重建 + 自写 ASAR/证据分析脚本（**未执行目标程序、未绕过任何技术保护措施**）

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

| 指标 | 数值 |
| --- | --- |
| 应用图谱节点 | **27,278** |
| 图谱边 | **32,977** |
| 解析的 JS 文件 | 4,489 |
| AST 节点 | 4,751,494 |
| 提取的发现 | 30,648 |
| Evidence 体积 | 354 MB |

### IPC 架构（最有价值的部分）

```
163 个 IPC 操作
 76 个字面量通道
 81 个主进程 handler
 65 个 renderer invoke ↔ 77 个 main handle
 13 个 renderer 监听
 59 个暴露的 API 成员
```

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
渲染侧全是 invoke、主侧全是 handle
配一对 subscribe / unsubscribe 事件流
→ 一套设计规范的完整 API
```

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
# 354 MB 的 evidence 不要直接读
node -e "
const ev=JSON.parse(require('fs').readFileSync('evidence.json','utf8'));
require('fs').writeFileSync('view.json', JSON.stringify({
  source:{kind:'inline',evidence:ev}, view:{kind:'summary'}
}));"
rea inspect-analysis-view view.json --format json
```

---

## 目录内容

```
tools/
  build-trace-input.cjs   ← 从保存的 evidence 构造追踪输入
  explore-evidence.cjs    ← 探查 evidence 结构（不加载全部到内存两次）
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
