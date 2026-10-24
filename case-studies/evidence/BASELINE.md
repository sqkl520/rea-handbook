# 一手证据

这个目录放的是**分析当时的原始输出**，不是我们的转述。

手册里的案例数字（27,278 节点、55 对 IPC 配对、3,757/16,197 个源文件……）
都来自这些文件。没有它们，读者能核对的只有我们的记账，没法核对分析本身。

## 文件

| 文件 | 是什么 | 大小 | 对应手册位置 |
| --- | --- | --- | --- |
| `trace-summary.json` | 追踪 `kill-sidecar` 的紧凑摘要：2 个种子命中、27,278 节点 / 32,977 边、5 个原生交接点 | 4.8 KB | `case-studies/README.md` 案例三；`guides/by-target-type.md` 第 107 行 |
| `trace-wsl-summary.json` | 追踪 `wsl-servers` 的摘要（同一个应用图谱，不同起点） | 1.9 KB | `case-studies/opencode.md`「WSL 服务器管理」一节 |

> 两份摘要的 `summary` 字段数值相同（27,278 节点等）——因为它们是**同一张应用图谱**上的两次追踪，
> 图谱规模不变，变的只是命中的起点。区分它们看 `seed` 与 `evidence_id`。

## 这些数字能怎么核

```bash
# 图谱规模（手册说 27,278 节点 / 32,977 边）
node -e "const d=require('./case-studies/evidence/trace-summary.json'); console.log(d.summary)"

# 原生交接点（手册说 5 个）
node -e "const d=require('./case-studies/evidence/trace-summary.json'); console.log(d.native_handoffs.map(h=>h.artifact_path))"

# 覆盖状态（手册说这是 partial，不是 complete）
node -e "const d=require('./case-studies/evidence/trace-summary.json'); console.log(d.coverage)"
```

`verify-handbook.mjs` 的【7】节会复核这些文件与手册里写的数字是否仍然一致。

## 为什么只有摘要，没有完整图谱

完整 evidence 是 354 MB。它进不了仓库，也不该进：

- **体积**：GitHub 单文件 100 MB 硬限。
- **可复现性**：完整图谱绑定在那一个版本的 `app.asar` 上（`sha256: 82ebf45b…`）。
  换了版本，数字就变——这跟 PCL2 那份报告遇到的"自更新漂移"是同一类问题。
- **摘要已经够用**：上面每个数字都能在摘要里查到；完整图谱只是把同样的结论摊开成 354 MB。

想自己产一份完整图谱：

```bash
rea analyze-javascript-application <你的 app.asar> \
  --integrity-policy record-and-continue --format json > evidence.json
```

## 数据说明

- **已脱敏**：无本机绝对路径、无用户名、无凭据。`node_modules/...` 这些路径是应用**内部**的
  包路径（来自归档本身），不是我们的机器。
- **未修改内容**：这是 REA 的原样输出，我们只做了删减（保存摘要而非全图），没有改动任何一个值。
- **evidence_id**：`ev_73720c52…`（在 `trace-summary.json` 末尾），可用它在完整 evidence 里反查。
