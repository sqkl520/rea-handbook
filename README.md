# REA Handbook（非官方）

> 一本 [REA](https://github.com/morluto/rea) 的第三方使用手册：入门指南 + 实战踩坑 + 提示词模板 + 三个真实案例分析 + 一组分析脚本。

[![License: MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)
[![Unofficial handbook](https://img.shields.io/badge/REA-Unofficial%20handbook-d73a49?style=flat-square)](NOTICE.md)
[![Based on REA 6.5.0](https://img.shields.io/badge/based%20on-REA%206.5.0-blue?style=flat-square)](https://www.npmjs.com/package/rea-agents)

> [!IMPORTANT]
> **非官方声明**：本仓库是 [REA](https://github.com/morluto/rea)（morluto，MIT 许可）的**第三方学习记录**，
> 与 REA 项目**无隶属、背书或赞助关系**。**REA 是 morluto 的 MIT 项目：<https://github.com/morluto/rea>。**
> 本仓库中的教程、提示词与脚本为原创内容；对 REA 的使用遵循其 MIT 许可。

## 免责声明

- 本仓库的逆向分析报告基于**公开获取的软件发行包**，使用**静态分析方法**（不执行目标程序、不绕过任何技术保护措施），目的为学习软件设计思想。
- 分析对象包括闭源商业软件（Plain Craft Launcher 2、ChatGPT 桌面版）与开源软件（OpenCode）。所有商标与代码版权归各自权利人。报告中的代码片段为分析中整理/重写的示意，用于说明设计思想。
- 报告**不包含**：可用于规避授权/付费机制的操作细节、密钥或凭据、个人隐私信息。
- 如果你是本报告分析对象的作者，对内容有异议，请通过 [issue](https://github.com/sqkl520/rea-handbook/issues) 联系，我们会处理。

## 这是什么

这是一本 **REA (Reverse Engineer Anything)** 的第三方使用手册，另附两份提示词模板、三个真实案例分析，和一组自写分析脚本。

REA 的官方文档很全，但它偏参考手册：按工具罗列参数与契约，较少回答"第一次用从哪开始""实际会踩什么坑"。本手册补的就是这两件事——**怎么上手**、**会踩什么坑**，包括官方文档没写、甚至与实测不符的地方（每条注明来源与验证方式）。

## 里面有什么

| 目录 | 内容 | 适合谁 |
| --- | --- | --- |
| [`docs/`](docs/) | 入门指南：环境准备、安装、第一个命令、核心概念 | 第一次用 REA |
| [`guides/`](guides/) | 按目标类型的操作手册 + 疑难排查 | 用起来卡住了 |
| [`prompts/`](prompts/) | 两份提示词模板：完整版（含项目映射）与纯学习版 | 想让 AI 帮你做逆向 |
| [`case-studies/`](case-studies/) | 三个真实案例：PCL2（VB.NET）、ChatGPT 桌面版、OpenCode 桌面版（Electron） | 想看实际产出 |
| [`tools/`](tools/) | 零依赖分析脚本：ASAR 解析、.NET 元数据、`#US` 字符串堆、IPC 扫描等 | 想自己动手深挖 |

## 快速开始

前置只有 Node.js 与 npm：**Node.js 22.19+ / 24.11+ / 26+**（不支持 23、25 及 prerelease 版本）。

```bash
# 1. 安装（二选一）
npx rea-agents setup              # 交互式：把 REA 注册到你的 AI agent（Claude Code / Codex / Cursor 等）
npm install --global rea-agents   # 或：只装命令行，得到 rea 命令

# 2. 确认安装与环境自检（可选）
rea --help
rea doctor                        # 报告本机哪些能力可用

# 3. 跑一个零依赖分析（不需要 Ghidra / IDA / Hopper）
rea inspect-go-binary /path/to/go-binary --json                # 任意 Go 编译的二进制
rea analyze-javascript-application /path/to/app.asar --json    # 静态分析 Electron 应用
```

不想全局安装时，每个命令都可以用 `npx -y rea-agents@latest <命令>` 一次性运行。

**大部分能力零依赖**：静态分析 JavaScript/Electron（ASAR 或目录）、Go/Rust 二进制、.NET 程序集、SQLite、Flutter、PE 资源等，只要 Node.js + npm。需要 Ghidra/Hopper/IDA 的只有原生二进制反编译一类。

平台限制不少（如 Windows 上 Hopper 不可用、Ghidra 仅实验性支持、部分能力仅限 Linux），细节见 [guides/](guides/)。想先看产出再动手，直接翻 [case-studies/](case-studies/)。

## 这手册和官方文档的关系

**官方文档是权威**：[morluto/rea](https://github.com/morluto/rea) 的 `docs/` 与官网 [rea.tools](https://rea.tools/)。

本手册基于官方文档 + 本机实测写成，补充两类官方没展开的东西：

1. **上手路径**——第一次用，按什么顺序做什么；
2. **实测的坑**——官方文档没有、或与实测不符的行为。

若与官方文档冲突，**以官方为准**。本手册基于 REA 6.5.0 写出，REA 更新很快，行为可能随版本变化。

## 手册里几个最有价值的发现

- **SQLite 的 Node 版本有独立的更严门槛。** 整体要求 24.11+，SQLite 却要求 **24.15+**（需要原生 `DatabaseSync.limits`）。24.11–24.14 是"满足整体、不满足 SQLite"的陷阱区间——SQLite 能力会报 `available: false`（`unsupported_version`），不细看结果就会漏掉。
- **`--filter-output` 写错多数静默返回空**（字段名笔误、路径不存在），但未闭合的 `[` 切片例外——会报 `INVALID_OUTPUT_FILTER`（未闭合的 `]` 仍静默）。
- **`trace-application-feature` 的官方文档给了一个实测不可用的 seed kind。** 文档把 `channel` 列为合法取值，但按源码逻辑它只匹配节点身份而非通道名，实测返回 no-match；改用 `string` 即可命中。
- **大 evidence 有 512 MiB 的 Node 硬墙。** V8 单个字符串长度上限约 512 MiB，超限即 `ERR_STRING_TOO_LONG`。几百 MB 的 evidence 投影要用 `jq` 流式处理，`node readFileSync` 路线会直接崩。
- **`rea capabilities` 不是完整能力清单。** 它只报告需要 provider（Ghidra 等）的操作；零依赖能力不在输出里——没列不等于不能用。

## 许可

- **本仓库**（手册、提示词、脚本、案例研究）：[MIT](LICENSE) © REA Handbook contributors。
- **REA**：是 [morluto/rea](https://github.com/morluto/rea) 的 MIT 项目（Copyright (c) morluto）。本手册引用其公开文档与行为描述，遵循其 MIT 许可。

## 致谢

- [REA](https://github.com/morluto/rea) 与其作者 morluto——本手册讲解的工具。
- REA 官方文档与 [rea.tools](https://rea.tools/)——本手册的事实基线。
- 三个案例的分析对象 PCL2、ChatGPT 桌面版、OpenCode。

完整的归属与第三方工具清单见 [NOTICE.md](NOTICE.md)。
