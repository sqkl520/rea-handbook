# 操作指南

用起来之后的两类文档：

| 指南 | 什么时候看 |
| --- | --- |
| [by-target-type.md](by-target-type.md) | **知道要分析什么**（.NET 程序集 / Electron 应用 / Go、Rust 二进制 / APK / SQLite / 网站…）→ 找到对应的命令序列，复制即用 |
| [troubleshooting.md](troubleshooting.md) | **卡住了**（报错、结果看起来不对、命令没输出…）→ 按你看到的现象查 |

两篇都基于 REA 6.5.0 的实测写成，标注了【实测】/【官方】等级。
通用约定（输出格式、退出码、选项约束）在 [by-target-type.md 的开头](by-target-type.md#读前必读四个通用约定)集中讲了一次，两篇都被它们影响，建议先扫一眼。

入门和 agent 接入见 [docs/](../docs/)；真实产出见 [case-studies/](../case-studies/)。
