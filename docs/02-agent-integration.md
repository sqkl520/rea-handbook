<!--
  基于 REA 6.5.0 编写。
  事实来源：官方 docs/installation.md、docs/client-configuration.md（权威）+ 本机实测（标注"实测"）。
  最后核对：2026-10-18
-->

# 接入你的 AI Agent

REA 有两种用法：**命令行**（`rea <命令>`）和 **MCP server**（让 AI agent 直接调用）。
这一页讲第二种——**把它接进你的 AI agent**。

## 为什么要接 MCP

命令行适合你手动查；接 MCP 适合**让 AI 帮你做完整的逆向任务**：

> "用 rea 分析这个 Electron 应用，告诉我它的 IPC 架构"

AI 会自己挑工具、串流程、读结果，你不必记 150+ 个命令。

## 一条命令搞定（推荐）

```bash
npx rea-agents setup
```

它会：

1. **检测**你装了哪些支持的 agent
2. 让你**多选**要配置哪些（已有的 REA 注册默认勾选）
3. 显示**完整的改动计划**（写哪些文件、装什么 skill）
4. **等你批准**后才动手
5. 写配置时**自动备份**（`.rea.backup`）

**装完重启 agent** 才会生效。

### 支持的 agent

setup 支持 **24 个** agent（`docs/installation.md` §Supported agents）。常用的：

| Agent | `--client` 值 |
| --- | --- |
| Claude Code | `claude_code` |
| Claude Desktop | `claude_desktop` |
| Codex | `codex` |
| Cursor | `cursor` |
| Gemini CLI | `gemini_cli` |
| Windsurf | `windsurf` |
| OpenCode | `opencode` |
| VS Code | `vscode` |
| GitHub Copilot CLI | `copilot_cli` |

完整列表（含 `kimi`、`hermes`、`trae`、`zcode` 等）见官方 `docs/installation.md`。

> ⚠️ **`dsh`、`kimi`、`workbuddy` 需要 6.5.0+**。官方文档的 registry 检查（6.4.0）未覆盖它们。

### 非交互式（脚本里用）

```bash
# 只配置指定的 agent，跳过交互选择
rea setup --client claude_code

# 先看计划不执行（退出码 0）
rea setup --client codex --skill=false --dry-run

# 全自动（谨慎：会配置每一个检测到的 agent）
rea setup --yes --all-detected

# 看结构化计划（不应用）
rea setup --json
```

**注意**：`--yes` 单独用时**只限于已有的 REA 注册**，不会选中所有检测到的 agent。
要广覆盖必须显式加 `--all-detected`。

### 关键选项

| 选项 | 作用 |
| --- | --- |
| `--client <id>` | 指定 agent（可重复） |
| `--dry-run` | 只看计划 |
| `--yes` / `-y` | 无提示批准 |
| `--skill=false` | 只注册 MCP，不装 skill |
| `--skill-client <id>` | 只刷新 skill |
| `--all-detected` | 配置所有检测到的 agent |
| `--accessible` | 顺序式提示（无障碍） |

### 退出码

| 状态 | 码 | 含义 |
| --- | --- | --- |
| `planned` | **0** | dry-run 完成 |
| `cancelled` | **0** | 你取消了 |
| `needs_confirmation` | **1** | 需要确认但没给 |
| `needs_human` | **1** | 需要人工介入 |

**注意**：取消 setup **也是退出码 0**——脚本里判断成功要看输出内容，不能只看码。

---

## 手动注册（setup 覆盖不到的情况）

有些场景必须手动：agent 不被 setup 支持、你想精确控制命令、或者要走项目级注册。

### 标准 JSON 片段

多数 MCP 客户端都认这个格式：

```json
{
  "mcpServers": {
    "rea": {
      "command": "npx",
      "args": ["-y", "rea-agents@6.5.0", "mcp"]
    }
  }
}
```

> **用确切的版本号，不要用 `@latest`**。官方明确说：
> "Persistent registrations should use one exact package version."
> `@latest` 会让你的注册随上游变化而漂移。

### Windows 特例

Windows 上 stdio 客户端**起不来 npx shim**，必须套一层 `cmd.exe`：

```json
{
  "mcpServers": {
    "rea": {
      "command": "cmd.exe",
      "args": ["/d", "/c", "npx", "-y", "rea-agents@6.5.0", "mcp"]
    }
  }
}
```

（`rea setup` **自己会做这个包装**；只有手动注册才需要你写。）

### 带 provider 环境的（原生分析）

如果你要用 Ghidra 等引擎，可以把环境变量写进注册：

```json
{
  "mcpServers": {
    "rea": {
      "command": "C:\\tools\\node\\node.exe",
      "args": ["C:\\tools\\rea\\scripts\\rea.mjs", "mcp"],
      "env": {
        "REA_ANALYSIS_PROVIDER": "ghidra",
        "GHIDRA_INSTALL_DIR": "C:\\tools\\ghidra_12.1.4_PUBLIC",
        "JAVA_HOME": "C:\\tools\\jdk-21"
      }
    }
  }
}
```

---

## 项目级 vs 全局级

**`rea setup` 默认是全局的**——写进用户的 agent 配置，**每个项目都能用**。

想限定到单个项目，有三条路：

### 路线 1：独立 profile（推荐）

```bash
# 用独立的配置目录，与你的默认 profile 隔离
CLAUDE_CONFIG_DIR=~/.claude-rea npx rea-agents setup --client claude_code
CLAUDE_CONFIG_DIR=~/.claude-rea claude
```

PowerShell：

```powershell
$env:CLAUDE_CONFIG_DIR = Join-Path $HOME ".claude-rea"
try {
  npx rea-agents setup --client claude_code
  claude
} finally {
  Remove-Item Env:\CLAUDE_CONFIG_DIR
}
```

**注意**：内联赋值只对该命令有效。之后每次检查/重跑/更新/移除都要带同样前缀——
否则你会**看不到自己刚装的注册**（因为不带变量时它查的是默认 profile）。

### 路线 2：Claude Code 的 local scope

从项目目录运行：

```bash
claude mcp add --scope local rea -- npx -y rea-agents@6.5.0 mcp
```

Windows：

```bash
claude mcp add --scope local rea -- cmd.exe /d /c npx -y rea-agents@6.5.0 mcp
```

local scope 的条目存在 `~/.claude.json` 里**该目录路径下**，其他项目不加载。

**三个要知道的后果**：
- `rea doctor` 和 `rea uninstall` **只读 user-level 条目**——不会报告或移除它
- `rea update` **也不刷新它**——它会停留在你写的那个版本
- 移除要回到同一目录：`claude mcp remove --scope local rea`

### 路线 3：完全不配 Claude Code

用 curl installer 的 `--no-setup`，或者只给别的 agent 跑 setup。

### ⚠️ 不要用 `--scope project`

那会往仓库里写 `.mcp.json`——**可能被提交或复制**。官方明确建议避免。

---

## 验证接好了没

### 对 agent 侧

```bash
# 看注册状态（不含 local scope）
rea doctor --client claude_code --json

# 只看 skill
rea doctor --skill --json
```

### 对 REA 侧

```bash
# 生产 MCP 启动自检：启进程、列工具、跑一次请求
rea mcp doctor --json
```

正常输出长这样（实测）：

```json
{
  "healthy": true,
  "adapter": "production-stdio",
  "server": { "name": "rea", "version": "6.5.0", "protocol_version": "2025-11-25" },
  "inventory": {
    "tools":   { "expected": 207, "observed": 207, "missing": [], "unexpected": [] },
    "prompts": { "expected": 6,   "observed": 6 }
  },
  "request_flow": { "tool": "binary_session", "ok": true }
}
```

**`tools.expected == tools.observed` 且 `request_flow.ok` 为真**——就说明 MCP 层没问题。

---

## 更新与卸载

### 更新

```bash
rea update                      # 全局安装的
npx rea-agents@latest setup     # npx 用户的 agent 注册
```

**更新后要重新跑 setup**（刷新注册与 skill），然后重启 agent。

注意：`rea update` **不管**源码 checkout 和 local-scope 注册。

### 卸载

```bash
rea uninstall                   # 只移除 REA 的注册和 skill
rea uninstall --purge-data      # 额外清理 ~/.rea 下的 cache/state
```

**它会保留**：Hopper、Node.js、evidence 文件、捕获、其他 skill、其他 MCP server。

**注意**：`uninstall` **不接受 `--client`**——它扫描所有受支持的客户端。

---

## 常见问题

**装完 agent 里看不到 REA 工具？**
1. **重启 agent**（配置变更需要重启才加载）
2. 跑 `rea mcp doctor` 确认服务本身没问题
3. 跑 `rea doctor --client <你的> --json` 看注册状态
4. 如果你是 `--scope local` 注册的，`rea doctor` **看不到它**（设计如此）——直接看 `~/.claude.json`

**setup 报 `needs_confirmation`（退出码 1）？**
那是没有批准就尝试应用。交互式跑，或显式加 `--yes` + 明确的 scope。

**Windows 上 agent 启不了 REA？**
检查注册里有没有 `cmd.exe /d /c` 包装。

**Claude Desktop 的注册被覆盖了？**
Claude Desktop（MSIX 版）在运行时会**从内存重写配置**。
官方建议：**先完全退出 Claude Desktop**，再跑 setup，然后启动。

---

## 参考

- 官方安装文档：`docs/installation.md`（agent 列表、setup 选项、项目级方案）
- 各客户端的配置文件路径：`docs/client-configuration.md`
- MCP 工具契约：`docs/mcp-contracts.md`
