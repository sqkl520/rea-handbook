# 操作指南

用起来之后的两类文档：

| 指南 | 什么时候看 |
| --- | --- |
| [by-target-type.md](by-target-type.md) | **知道要分析什么**（.NET 程序集 / Electron 应用 / Go、Rust 二进制 / APK / SQLite / 网站…）→ 找到对应的命令序列，复制即用 |
| [troubleshooting.md](troubleshooting.md) | **卡住了**（报错、结果看起来不对、命令没输出…）→ 按你看到的现象查 |

两篇都基于 REA 6.8.0 写成，但**标注体系不同**：

- [by-target-type.md](by-target-type.md) 用【官方】/【实测】/【我们的发现】三级标签
- [troubleshooting.md](troubleshooting.md) 用 `[官方已说明]` / `[手册补充]` 两级标记

两者都在回答同一件事——“这条结论是别人写的，还是我们撞出来的”——只是分档粒度不一样。
通用约定（输出格式、退出码、选项约束）在 [by-target-type.md 的开头](by-target-type.md#读前必读四个通用约定)集中讲了一次，两篇都被它们影响，建议先扫一眼。

入门和 agent 接入见 [docs/](../docs/)；真实产出见 [case-studies/](../case-studies/)。
