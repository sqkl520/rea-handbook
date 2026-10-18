# Codex 桌面版（ChatGPT App）UI 架构分析

用 REA 分析的目标：`<ChatGPT 桌面版安装目录>/app`
分析日期：2026-10-15　目标版本：26.1007.2314.0（显示名 "ChatGPT"）

> **分析声明**：本分析基于**公开获取的软件发行包**（用户本机已安装副本），
> 使用**静态分析方法**——不执行目标程序、不绕过任何技术保护措施，
> 目的是学习其**打包形态与 UI 工程做法**。报告中的代码片段为分析中整理/重写的示意，
> 版权归 OpenAI。如果你是本报告分析对象的作者、对内容有异议，
> 请通过 [issue](https://github.com/sqkl520/rea-handbook/issues) 联系，我们会处理。

**一个修正**：我最初判断"它不是一个 Electron 应用，是 Chromium 内嵌 shell"——**这个判断是错的**。
它在主进程 bundle 里有 134 处 `BrowserWindow`、20 处 `ipcMain`、`process.versions.electron` 分支，
是标准的 **Electron 应用**。它看起来不像典型 Electron 的原因是：`ChatGPT.exe` 只有 4.7MB，
Chromium 被拆到独立的 `chrome.dll`（329MB），这是 Electron 在 Windows 上配合 MSIX 打包的
形态。显示名是 "ChatGPT"，但包名/入口是 `openai-codex-electron`。

---

## 一句话回答：UI 为什么这么灵活

因为它在**每个抽象层次都留了插槽**，而不是写死一套布局：

| 层次 | 机制 | 实测数字 |
| --- | --- | --- |
| 组件级响应式 | **CSS 容器查询**（按组件自身宽度，不是视口） | 44 个命名容器 |
| 样式层 | **Tailwind CSS v4** + CSS Modules | 5,131 个 `--tw-*` 变量、121 个组件 |
| 主题层 | **三层设计令牌**，全部可被宿主覆盖 | 2,035 个自定义属性、100 个 `@property` |
| 布局层 | 全 app-shell 的容器化网格 | `app-shell-*` 系列容器 |
| 平台集成 | 读取 VS Code 字体变量 | `--vscode-editor-font-family` |
| 运行时能力 | WASM 沙箱化扩展（含整个 .NET 运行时） | 31 个 wasm 模块 |

---

## 1. 打包形态与构建管线

```
app/
├── ChatGPT.exe            4.7 MB   （Electron 外壳，显示名 ChatGPT）
├── chrome.dll           329 MB   （Electron 打包的 Chromium 155）
├── resources/
│   ├── app.asar         567 MB   （JS 应用层，20,988 个文件）
│   └── app.asar.unpacked/node_modules/
│       ├── better-sqlite3    （原生 SQLite 绑定）
│       ├── node-pty          （伪终端）
│       └── @worklouder/      （硬件设备集成）
```

构建工具链（从产物痕迹反推）：

- **rolldown**（产物里有 `rolldown-runtime-*.js`）—— Rust 写的打包器，Vite 6+ 的新默认
- **lightningcss**（CSS 里有 714 个 `--lightningcss-*` 变量）—— Rust 写的 CSS 处理管线
- **Vite**（`__vite__mapDeps`、`.vite/build/` 目录结构）
- **Tailwind CSS v4**（`@layer theme, base, components, utilities` 四层声明 + `@property` 注册）

这个组合很说明问题：**rolldown + lightningcss 都是 Rust 实现**。19,000+ 个资源、567MB 的
归档，用 JS 工具链构建会很痛苦，所以选了 Rust 系。这也是为什么一个"聊天应用"的安装包能有 1.1GB——
它把大量东西**预编译进产物**而不是运行时加载。

---

## 2. UI 灵活性的核心：44 个命名容器查询

这是整个分析里最有价值的发现。它用的是 **CSS Container Queries**（容器查询）而不是媒体查询。

差别在于：媒体查询看的是**视口宽度**，容器查询看的是**组件自己所在的容器宽度**。
所以同一个 `ApprovalCard` 组件，放在侧边栏（窄）和放在主区域（宽）会自动呈现不同布局，
不需要任何 JS，也不需要知道自己在哪。

实测提取的 44 个命名容器：

```
address, app-shell-detail-panel, app-shell-header-toolbar, app-shell-main-content,
app-shell-tab, approval-card, browser-toolbar, business-editor, contact-setup,
diff-header, flashcard-editor, flashcards, getting-started, gpt-builder,
home-mode-toggle, hours, keyboard-shortcuts, latest-turn-preview, left-panel,
library-row, navigation-header, page, page-activity, page-comments, page-document,
page-explorer, page-toolbar, presentation-editor, priority-list, product-carousel,
product-reference, referral-tracking, request-card, review-header, searchable-header,
settings-row, sidebar-update, site-preview, sketch-canvas, skills-grid,
tortilla-detail, video-controls, work-tasks, work-welcome
```

从命名能读出产品结构：`app-shell-*`（应用外壳）、`page-*`（页面体系）、
`flashcard-*`/`presentation-editor`/`sketch-canvas`/`site-preview`（这些是**生成式 UI 产物**的
编辑器）、`business-editor`/`product-reference`（商业工具）、`work-*`（工作流）。

配合 190 个 `@container` 规则的用法：每个容器在自己的 CSS Module 里声明
`container: 名字/inline-size`，然后组件内部用 `@container 名字 (width >= X)` 做自适应。

**和媒体查询的比例**：83 个媒体查询 vs 190 个容器查询规则。也就是说响应式的主力是容器查询。
媒体查询只用在真正跟设备相关的场景（`hover:hover`、`pointer:coarse`、`forced-colors`、
`prefers-reduced-motion`、`resolution >= 150dpi`）。

---

## 3. 三层设计令牌体系

CSS 里有 **2,035 个自定义属性**，它们不是平铺的，而是分层的：

```
第 1 层（语义令牌，组件直接消费）
  --color-token-text-primary: var(--color-token-foreground)
  --color-token-foreground:   var(--app-color-text-foreground)

第 2 层（应用主题，可被整体替换）
  --app-color-text-foreground
  --app-color-border-heavy
  --app-color-background-button-secondary

第 3 层（原始值）
  --gray-*, --blue-*, --red-* …
```

好处：组件只认第 1 层。想换主题（比如强制深色、或者接入别家品牌色），
只需要重定义第 2 层，**121 个组件一行都不用改**。

实测令牌前缀分布（Top 12）：

```
   5131  --tw-*        （Tailwind 运行时状态变量）
   4063  --color-*
   2416  --spacing-*
    714  --lightningcss-*
    510  --app-*
    445  --text-*
    413  --vscode-*    ← 注意这个
    404  --button-*
    367  --font-*
    304  --radius-*
    233  --theme-*
    224  --gray-*
```

**413 个 `--vscode-*` 变量**是个很有意思的设计：它主动读取 VS Code 的主题/字体变量。
实测到的连接点：

```css
--font-code-family: var(--vscode-editor-font-family, var(--font-mono-default))
--font-code-size:   var(--vscode-editor-font-size)
--font-code-weight: var(--vscode-editor-font-weight)
```

意思是：**如果你装了 VS Code 且自定义了编辑器字体，Codex 的代码区会跟着变。**
它把自己当成了"编辑器生态的一员"，而不是独立应用。

### 主题切换机制

用属性选择器 + `:where()`（保证零特异性，方便覆盖）：

```css
._Button_eg66f_2[data-variant=surface]:where(:not([data-disabled])):where([data-theme=dark]):before
```

同时还有 `@container style(--theme-variant: dark)` 这种**样式容器查询**——
让父级可以通过设置 CSS 变量来切换整个子树的主题，不需要传 props。

### 排版系统

用比例尺变量，每组四元组（大小/行高/字重/字距）：

```css
--font-heading-5xl-size: 4.5rem
--font-heading-5xl-line-height: 4.5rem      /* 行高=字号，紧凑标题 */
--font-heading-5xl-weight: var(--font-weight-semibold)
--font-heading-5xl-tracking: var(--tracking-tight)
```

### 动效

刻意做了克制——只有 3 档时长：

```css
--transition-duration-basic:    .15s
--transition-duration-moderate: .2s
--transition-duration-relaxed:  .3s
```

16 个 keyframes，其中值得注意的：`loading-shimmer`（加载微光）、
`edge-fade`（边缘渐隐，用于可滚动区域提示）、`token-pulsing-dot`（流式输出光标）、
`shake`（错误反馈）、`_progression-donut-fill`（环形进度）。

---

## 4. 前端跑着完整的 .NET WASM 运行时

这是最出乎意料的发现。assets 目录里有：

| 文件 | 大小 | 作用 |
| --- | --- | --- |
| `System.Private.CoreLib.*.wasm` | 1.49 MB | .NET 运行时核心 |
| `dotnet.native.*.wasm` | 1.45 MB | .NET 原生导出层 |
| `DocumentFormat.OpenXml.*.wasm` | 4.18 MB | Office 文档格式库 |
| `Walnut.*.wasm` | 2.89 MB | （OpenAI 内部组件） |
| `System.IO.Packaging.*.wasm` | 0.07 MB | OOXML 容器格式 |
| `System.Xml.*` / `System.Linq.*` 等 | ~3 MB | 标准库切片 |

配合 assets 里真实的 `docx`/`pptx`/`xlsx` 模板文件各 3 个。

**推论**：它的 Office 文档生成/编辑功能**在前端用 .NET 编译成 WASM 跑**，而不是发到服务端。
好处是文档处理完全本地、不需要往返网络；代价是 UI 包里塞了一个 .NET 运行时。
这是"能力本地化"策略的极端体现——和它把 SQLite（`better-sqlite3`）、终端（`node-pty`）、
文档（.NET WASM）都放进本地是同一个思路。

---

## 5. 组件与状态管理栈

从 bundle 探针确认：

- **React**（`createElement`、`useState`、`useEffect`、`createContext`，
  且含 React 19 专属 hooks：`useOptimistic`、`useActionState`、`useFormStatus`）
- **framer-motion** —— 动画（94 处 motion 引用）
- **Radix UI** —— 无头组件原语（无障碍、键盘导航）
- **xstate** —— 状态机（复杂交互流程）
- **Emotion** —— CSS-in-JS
- **shiki** + **prism** —— 代码高亮（双引擎）
- **Sentry** —— 错误上报（`@sentry/electron`，preload 里注入 `__SENTRY_IPC__`）

### 代码高亮的懒加载设计

`__vite__mapDeps` 里列了 **200+ 种语言**的独立 chunk，每种一个文件，
按需 `import()`。文件名如 `python-fdf8b6adcc28.js`、`rust-a8f356715551.js`。
同理，**2,983 个 locale chunk**（`my-MM` 缅甸语 4.99MB、`ta-IN` 泰米尔语 4.97MB……）。

**值得注意**：单个 locale chunk 能到 5MB，说明**每种语言的翻译是内联打包的**，
不是运行时从 CDN 拉。这跟"能力本地化"的策略一致。
23 种语言的字体（OpenAI Sans/Serif、KaTeX 全套、carlito）也都在本地。

---

## 6. 跨进程架构：集中式通道常量表

UI 的"灵活"也体现在进程边界的组织方式上。扫描主进程 bundle 发现：

**通道名不是散落的字符串字面量，而是集中在 `bootstrap` 模块的常量表里**，
通过命名空间前缀组织。这类设计让"有哪些能力"变成一份可枚举的清单。

### `codex_desktop:` 主通道表（23 个，全部实测提取）

```
codex_desktop:message-from-view            渲染→主（核心消息通道）
codex_desktop:message-for-view             主→渲染
codex_desktop:chunked-message-ack          分块消息确认（大消息流控）
codex_desktop:worker:${id}:from-view       ← 动态工厂，每个 worker 一对
codex_desktop:worker:${id}:for-view
codex_desktop:connect-app-host             App Host RPC 连接
codex_desktop:browser-page-event           浏览器页面事件
codex_desktop:browser-sidebar-runtime-message
codex_desktop:mcp-app-sandbox-guest-message   ← MCP 沙箱双向
codex_desktop:mcp-app-sandbox-host-message
codex_desktop:get-initial-sidebar-bootstrap
codex_desktop:get-shared-object-snapshot
codex_desktop:get-system-theme-variant
codex_desktop:system-theme-variant-updated
codex_desktop:get-sentry-init-options
codex_desktop:trigger-sentry-test
codex_desktop:get-build-flavor
codex_desktop:check-for-updates
codex_desktop:get-fast-mode-rollout-metrics
codex_desktop:remote-hosted-pip-video-frame   ← 画中画视频帧
codex_desktop:show-context-menu
codex_desktop:start-file-drag
codex_desktop:start-link-drag
```

架构要点：

1. **`worker:${id}:{from,for}-view` 是动态工厂** —— 每个 worker 实例分配一对专属通道。
   这解释了我最初正则扫不到通道名：主 bundle 里只有 `g.zt(e)` 这样的调用，
   真实名字在运行时才拼出来。
2. **同步通道存在**：`ipcMain.on` + `e.returnValue = ...` 的模式出现多次
   （`get-shared-object-snapshot`、`get-initial-sidebar-bootstrap`、
   `get-system-theme-variant`、`start-file-drag`），这些是**同步阻塞**调用——
   渲染进程需要立刻拿到值，不能等 Promise。
3. **`isTrustedIpcEvent` 是每个 handler 的第一道门** —— 所有 `ipcMain.handle`/`.on`
   回调开头都先做来源校验，不通过直接 return 或不写 returnValue。
   这是防御不可信 frame 的标准做法。

### `codex:` 浏览器标注通道（browser-page-preload，527KB）

```
codex:annotation-surface-request / -response / -available / -pending
codex:annotation-shadow-root-attached
codex:register-annotation-controls / update- / dispose-
codex:open-annotation
codex_desktop:get-browser-annotation-api-policy
codex_desktop:get-browser-webmcp-policy
```

→ 证实它有**页面标注系统**（在网页上画标注、注入 Shadow DOM 控件），
且有独立的策略下发通道（annotation API policy、WebMCP policy）。

### 渲染进程的接入点

`webview` bundle 里：
- `electronBridge` 出现 28 次、`window.electron` 27 次
- 主 preload 通过 `contextBridge.exposeInMainWorld` 暴露三个名字：
  **`__SENTRY_IPC__`、`codexWindowType`、`electronBridge`**

`electronBridge` 是渲染进程访问主进程能力的统一入口（如
`window.electronBridge?.startLinkDrag`）。渲染层代码通过可选链调用，
**在纯 Web 环境下自动降级**——这正是 UI 能同时服务于桌面版和网页版的关键：
它把桌面能力当成"可选增强"，而不是硬依赖。

---

## 7. 多窗口与安全边界

### 多窗口架构
`detached-window.html` 独立存在——支持把会话/面板**拖出成独立窗口**。
配合主窗口的 `app-shell-tab` 容器，实现标签页体系。

### CSP 白名单（从 index.html 提取）
```
default-src 'none'                          ← 默认全禁
script-src  'self' + 一个 sha256 哈希 + 'wasm-unsafe-eval' + 2 个白名单 CDN
frame-src   沙箱域 + plaid/google docs/vimeo/youtube/mapkit/mapbox 等
connect-src 'self' + OpenAI 各域名 + API 域名
```

值得注意：
1. `default-src 'none'` —— 默认拒绝一切，再逐项开口子（最严格的白名单模式）
2. 允许 `'wasm-unsafe-eval'` —— 正是为了上面那套 .NET WASM
3. `frame-src` 允许 `docs.google.com/document/d/`、`player.vimeo.com`、`youtube.com`、
   `cdn.plaid.com`（支付）、`mapkit`/`mapbox`（地图）—— 说明它有**富媒体嵌入**能力
4. 沙箱用自定义协议 `codex-sandbox://` 隔离，指向 `web-sandbox.oaiusercontent.com`

### 权限隔离
`.vite/build/` 下有三个不同的 preload/worker：
- `preload.js` —— 主窗口 preload（仅 Sentry IPC）
- `browser-page-preload.js`（527KB）—— **浏览器功能**的页面注入
- `sandbox-preload.js` —— 沙箱 iframe 的 preload

配合 fuses 观测（之前分析）：`RunAsNode` 启用、`EnableNodeCliInspectArguments` 启用、
`EnableEmbeddedAsarIntegrityValidation` 关闭。

---

## 8. 产品面（从资源命名反推）

`webview/apps/` 下 29 个编辑器图标：

```
vscode, vscode-insiders, cursor, windsurf, zed, sublime-text, textmate, bbedit,
emacs, vim系(ghostty/warp/iterm2/kitty/terminal/microsoft-terminal/cmder),
intellij, pycharm, webstorm, goland, phpstorm, rider, rustrover, android-studio,
xcode, devin, antigravity, finder, file-explorer
```

→ 有**"在外部编辑器中打开"**的深度集成，覆盖 29 种工具。

`orbit-character/` 目录（20MB）：
- `orbit-characters.wasm` 6.4MB + `orbit-characters.data` 3.5MB
- `frame.html`/`frame.mjs`/`presentation.mjs`（62KB）—— 一个独立的渲染帧
- `picker-thumbnails`、`preset-previews`

→ 这是一套 **WASM 驱动的角色/头像系统**（"orbit"是项目代号），
有自己的独立渲染容器和预设体系。

`service-worker/events.js` 里有一行注释直接链到上游：
```js
// Keep the canonical worker URL and protocol compatible with ChatGPT web.
// https://github.com/openai/openai/blob/master/chatgpt/web/public/service-worker/events.js
```
→ 证实**桌面版 UI 与 ChatGPT 网页版共享代码库**，桌面版是网页版的超集。

---

## 方法论备注

本次分析用到的 REA 能力：

1. `analyze-javascript-application` —— 拿到了图谱骨架。但**对 567MB / 19,000 文件的归档，
   默认预算不足以完成**：父进程结果容量 = `(V8 堆上限 - 已用堆 - 预留) / 2`，
   而 `NODE_OPTIONS` 被 REA 主动剥离（给 worker 干净环境），所以简单调环境变量没用。
   它返回了部分结果并**明确标注了限制**，没有假装完整。
2. 直接 ASAR 解析（自写脚本）—— 头部是 pickle 格式：
   `u32@0=4`（pickle 标记）、`u32@4=`头部总长、`u32@12=`JSON 长度、
   数据区偏移 `base = 8 + u32@4`。注意有 3 字节对齐填充。
3. `inspect-electron-fuses` —— 秒级拿到安全开关状态。

**教训**：REA 的静态分析适合**中等规模**目标（OpenCode 146MB 全程跑通）。
超大目标要么分层分析（只喂 `--source-path` 选定的子集），要么用直接解析补充。
后者的代价是没有 REA 的证据链和跨文件关联，只能看到"文件里有什么"，
看不到"谁调用了谁"。
