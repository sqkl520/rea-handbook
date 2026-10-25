# 分析脚本

这些脚本是我们在实际逆向分析中写的**辅助工具**。它们**零依赖**（只用 Node.js 内置模块），
可以直接 `node <脚本> <参数>` 运行。

> **它们不是 REA 的一部分**——REA 是 [morluto/rea](https://github.com/morluto/rea)（MIT）。
> 这些脚本用于**补充** REA 覆盖不到的角度（比如直接读归档结构、解析元数据表）。

## 为什么需要这些脚本

REA 已经覆盖了很多场景，但有几类事它（或任何工具）做不了：

| 场景 | 为什么需要自己写 |
| --- | --- |
| 想直接看归档里的某个文件 | REA 返回的是**图谱**，不是文件内容 |
| 需要完整的类型清单 | REA 的 `.NET` 全量提取会因 64 MiB 预算失败，得自己读元数据表 |
| 想提取二进制里的所有字符串 | REA 按类型返回字符串，不给全局视图 |
| 想处理几百 MB 的 evidence | 需要流式/投影，而不是一次性读进内存 |

**这些脚本都是「够用就好」的**——13 个在 130 行以内，最长的 `dotnet-metadata.cjs` 275 行
（它要手写 ECMA-335 的元数据表解析，短不下来）。读得懂，可以按需改。

---

## 脚本清单

### ASAR / Electron 应用

| 脚本 | 用途 | 用法 |
| --- | --- | --- |
| `asar-peek.cjs` | 解析 ASAR 头部，列出目录结构与 `package.json` | `node asar-peek.cjs <app.asar> package.json --layout` |
| `asar-get.cjs` | 按路径读归档内的文件，或列目录 | `node asar-get.cjs <app.asar> --dir:/webview/apps` |
| `asset-taxonomy.cjs` | 资源分类统计（js/svg/webp/wasm/font…，自动探测 JS 目录） | `node asset-taxonomy.cjs <app.asar> [js目录]` |
| `css-deep.cjs` | CSS 深度分析（框架指纹、设计令牌、容器查询） | `node css-deep.cjs <app.asar> /path/to/style.css` |
| `js-stack.cjs` | JS 库探针（React/Vue/Svelte…，带匹配计数） | `node js-stack.cjs <app.asar> [js目录]` |

**ASAR 格式的关键知识**（自己写解析器时会用到）：

```
头部是 pickle 格式：
  u32@0  = 4（pickle 标记）
  u32@4  = 头部总长度
  u32@12 = JSON 头部长度
  数据区偏移 = 8 + u32@4     ← ★ 注意有对齐填充，不是 16 + jsonLength
```

### .NET 程序集

| 脚本 | 用途 | 用法 |
| --- | --- | --- |
| `dotnet-metadata.cjs` | 直接读 PE/CLI 元数据表，拿**完整类型清单**（绕开 REA 的 64 MiB 预算） | `node dotnet-metadata.cjs <assembly> <outPrefix>` |
| `us-strings.cjs` | 扫二进制里的 UTF-16LE 可读串 | `node us-strings.cjs <assembly>` |
| `us-resolve.cjs` | `#US` 字符串堆 token → 文本（`--dump` 导全堆到文件） | `node us-resolve.cjs <assembly> --dump [out.txt]` |
| `us-tokens.cjs` | 用模糊 offset 匹配，把 token 列表解析成字符串 | `node us-tokens.cjs <us-heap.txt> 0x700145e0 ...` |
| `leak-paths.cjs` | 从 `.text` 段提取泄漏的**源码路径**，还原目录树（可传 rootFilter 只看自己的项目） | `node leak-paths.cjs <assembly> ["Projects\\MyApp"]` |

**为什么 `.NET` 的字符串要按 UTF-16LE 读**：`ldstr` 字面量存在 `#US` 堆里，编码是 UTF-16LE。
用 ASCII 扫什么都看不到，中文和 URL 更是完全出不来。

**`#US` token 解析注意**：token 形如 `0x70xxxxxx`，堆内偏移 = `token & 0xffffff`，
**注意要 -1**（堆从偏移 1 开始，偏移 0 是空字节）。

### REA evidence 处理

| 脚本 | 用途 | 用法 |
| --- | --- | --- |
| `build-trace-input.cjs` | 从保存的 evidence 构造功能追踪的输入 | `node build-trace-input.cjs <evidence.json> <out.json> string <种子>` |
| `explore-evidence.cjs` | 探查 evidence 的顶层结构（一次 `JSON.parse` 后遍历，不做流式） | `node explore-evidence.cjs <evidence.json>` |
| `find-channels.cjs` | 在 evidence 树里定位 IPC 通道数据 | `node find-channels.cjs <evidence.json>` |
| `rea-type-view.cjs` | 把 REA 的 `--type` 输出渲染成紧凑视图 | `node rea-type-view.cjs <rea-output.json>` |

**`build-trace-input.cjs` 的坑**：种子类型（`string` / `channel` / `route`…）
用 `string` 最可靠。用 `channel` 会因为只匹配节点身份而常常返回 `no-match`
（详见[疑难排查](../guides/troubleshooting.md)）。

---

## 使用前提

1. **Node.js**（与本手册基线的 REA 6.5.0 一致：`^22.19.0 || ^24.11.0 || >=26.0.0`；6.8.0 起是 `^22.23.4 || ^24.22.1 || >=26.12.1`）
2. 这些脚本**没有 npm 依赖**——不用 `npm install`

```bash
# 直接跑
node asar-peek.cjs "/path/to/app.asar" package.json --layout

# 归档内路径两种写法都行（前导斜杠可省）：
node asar-get.cjs "<app.asar>" --dir:/webview/apps
node asar-get.cjs "<app.asar>" --dir:webview/apps
```

## 平台注意

| 事项 | 说明 |
| --- | --- |
| **路径分隔符** | 脚本接受 `/` 和 `\` 两种写法（Node 在 Windows 上都能处理） |
| **Git Bash 参数转换** | MSYS 会把 `/webview/apps` 改写成 `D:/Git/webview/apps`。`asar-get.cjs` 会自动还原这种改写；其他脚本对 `/` 开头的归档内路径建议加 `MSYS_NO_PATHCONV=1`（但它同时会阻止 `/c/...` 这类主机路径转换，此时主机路径请写成 `C:/...`）。**macOS / Linux 无此类转换问题**，直接运行即可 |
| **文件大小** | 有四个脚本会把整个 JSON 一次解析进内存：`explore-evidence.cjs`、`find-channels.cjs`、`build-trace-input.cjs`、`rea-type-view.cjs`。**超过 ~500 MB 的文件不要用它们**（Node 有单字符串 512 MiB 硬上限，超了直接 `ERR_STRING_TOO_LONG`）。这个体量请走 `jq` 流式投影，或先用 REA 的 `--filter-output` 缩小输出。 |

## 自己写脚本的建议

**这几类事值得自己写**（REA 不覆盖或覆盖不好）：

1. **直接读归档结构**（ASAR / ZIP / MSIX）——REA 返回图谱，不给文件内容
2. **解析平台特有的元数据表**（PE/CLI、Mach-O load commands、ELF sections）
3. **字符串提取**——尤其是非 ASCII 编码（UTF-16LE、GBK）
4. **大文件的流式处理**——不要 `readFileSync` 几百 MB 的东西
5. **泄漏信息的挖掘**——调试路径、版本字符串、内嵌 URL

**写之前先看看**：REA 是不是已经有对应能力了（`rea --help` 有 150+ 命令，
也见[按目标类型](../guides/by-target-type.md)）。

---

## 许可

这些脚本是本手册原创，MIT 许可（见[仓库 LICENSE](../LICENSE)）。
