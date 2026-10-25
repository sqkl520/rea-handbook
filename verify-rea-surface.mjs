#!/usr/bin/env node
// 对着"已安装的 REA"核对本手册里出现的命令名、旗标、以及版本常量。
//
// verify-handbook.mjs 只回答"仓库内部是否自洽"，从不调用 rea——所以 REA 改名、
// 抬门槛、改 id 列表这类漂移它一处都发现不了。这个脚本补上那一半。
//
// 用法：
//   node verify-rea-surface.mjs              # 用 npx 拉当前最新版
//   node verify-rea-surface.mjs --rea <path> # 用本地安装的 rea（离线、快）
//   node verify-rea-surface.mjs --version 6.5.0
//
// 退出码：0 全部对得上；1 有对不上的；2 环境不可用（没有 rea / 拿不到清单）。

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

let problems = 0;
const warn = (m) => {
  console.log('  ⚠️  ' + m);
  problems++;
};
const ok = (m) => console.log('  ✅ ' + m);
const info = (m) => console.log('  ·  ' + m);

// ── 1. 拿到 REA 的命令 / 工具 / 版本清单 ──
// 三条来源，任一可用即可：
//   a) 本地已装包里的 dist/cliCommandNames.js + dist/mcp-catalog-full.json
//   b) npm pack 到临时目录（离线可用，只要 registry 能连）
//   c) rea --help / rea --mcp（需要真的能跑）
function loadFromPackageDir(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const namesPath = join(dir, 'dist/cliCommandNames.js');
  const catalogPath = join(dir, 'dist/mcp-catalog-full.json');
  // 命令清单是硬性要求；catalog 不是。
  // mcp-catalog-full.json 是 6.8.0 才引入的，6.5.0 的包里没有——
  // 早先把它写成硬性前提，导致这个检查器对 6.5.0 基线完全跑不了。
  if (!existsSync(namesPath)) return null;

  // cliCommandNames.js 是 ESM：
  //   export const CLI_COMMANDS = Object.freeze({ camelName: "kebab-name", ... })
  //   export const CLI_COMMAND_NAMES = Object.freeze(Object.values(CLI_COMMANDS));
  // 不动态 import（包装有 exports 限制），直接抽对象里的字符串值。
  const src = readFileSync(namesPath, 'utf8');
  const body = /CLI_COMMANDS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(src);
  if (!body) return null;
  const commands = [...body[1].matchAll(/:\s*"([^"]+)"/g)].map((x) => x[1]);
  if (!commands.length) return null;

  // catalog 存在就用（6.8.0+ 能拿到 MCP 工具名）；不存在就跳过，命令名照样能查
  let tools = [];
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    tools = (catalog.tools || []).map((t) => t.name);
  }

  const testsPath = join(dir, 'dist/application/DoctorProviderIds.js');
  let providers = [];
  if (existsSync(testsPath)) {
    const p = readFileSync(testsPath, 'utf8');
    const pm = /DOCTOR_PROVIDER_IDS\s*=\s*\[([\s\S]*?)\]/.exec(p);
    if (pm) providers = [...pm[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }

  return {
    version: pkg.version,
    node: pkg.engines?.node || '',
    commands,
    tools,
    providers,
  };
}

function resolveSurface() {
  const explicit = argOf('--rea');
  if (explicit) {
    // --rea 可能是：包目录本身 / node_modules 目录 / 解压出的上级目录
    for (const cand of [explicit, join(explicit, 'node_modules/rea-agents'), join(explicit, 'package')]) {
      const s = loadFromPackageDir(cand);
      if (s) return s;
    }
  }

  // 已装全局包
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    const s = loadFromPackageDir(join(globalRoot, 'rea-agents'));
    if (s) return s;
  } catch {
    /* 没有 npm 或没有全局包 */
  }

  // 从 registry 拉一份
  const version = argOf('--version') || 'latest';
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'rea-surface-'));
    execFileSync('npm', ['pack', `rea-agents@${version}`, '--silent'], { cwd: tmp, encoding: 'utf8' });
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!tgz) return null;
    execFileSync('tar', ['-xzf', tgz], { cwd: tmp });
    return loadFromPackageDir(join(tmp, 'package'));
  } catch {
    return null;
  }
}

console.log('\nREA 表面核对\n');

const surface = resolveSurface();
if (!surface) {
  console.log('  ❌ 拿不到 REA 的命令清单。');
  console.log('     试试：node verify-rea-surface.mjs --rea <已解压的 rea-agents 包目录>');
  console.log('     或者先 npm install -g rea-agents');
  process.exit(2);
}
info(`对照版本：REA ${surface.version}`);
info(
  `清单：${surface.commands.length} 个 CLI 命令 / ` +
    (surface.tools.length ? `${surface.tools.length} 个 MCP 工具` : '无 MCP 工具清单（该版本包内没有 catalog）') +
    ` / ${surface.providers.length} 个 doctor provider`
);

// ── 2. 收集仓库里出现的命令与旗标 ──
const TEXT_EXT = /\.(md|mjs|cjs)$/;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name)) out.push(p);
  }
  return out;
}
let gitFiles = null;
try {
  gitFiles = new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .map((f) => f.split('\\').join('/'))
  );
} catch {
  /* 不是 git 工作区 */
}
const files = walk(ROOT).filter(
  (f) => !gitFiles || gitFiles.has(relative(ROOT, f).split('\\').join('/'))
);

const commandSet = new Set(surface.commands);
const knownCommand = (c) => commandSet.has(c);

// 从文档里抽命令：`rea <word>` 或 `npx ... rea-agents@x <word>` 或纯反引号里的 <word>
const COMMAND_RE = /(?:^|[\s`$>|])(?:rea|npx\s+-y\s+rea-agents(?:@[\d.]+)?)\s+([a-z][a-z0-9-]{2,})/g;
const BARE_RE = /`([a-z][a-z0-9]+(?:-[a-z0-9]+){1,4})`/g;

const seenCommands = new Map(); // name -> [file:line]
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f);
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(COMMAND_RE)) {
      const c = m[1];
      // 占位写法（rea <命令> / rea xxx）不是真命令
      if (c === 'xxx' || c.startsWith('<')) continue;
      if (!seenCommands.has(c)) seenCommands.set(c, []);
      seenCommands.get(c).push(`${rel}:${i + 1}`);
    }
  });
}

// ── 3. 核对命令名 ──
console.log('\n【1】CLI 命令名');
// 子命令与全局旗标不在 CLI_COMMANDS 里，但文档会写 `rea mcp` / `rea setup`
const SUBCOMMANDS = new Set(['mcp', 'setup', 'uninstall', 'doctor', 'help']);
let unknownCount = 0;
for (const [c, where] of seenCommands) {
  if (knownCommand(c) || SUBCOMMANDS.has(c)) continue;
  // 排除明显的非命令词
  if (/^(help|version|json|format|provider|type|output|filter|scope|dry|run|max|min)$/.test(c)) continue;
  unknownCount++;
  warn(`命令 "${c}" 不在 REA ${surface.version} 的 ${surface.commands.length} 个命令里（${where.slice(0, 3).join(', ')}${where.length > 3 ? ` 等 ${where.length} 处` : ''}）`);
}
if (!unknownCount) ok(`${seenCommands.size} 个被引用的命令名全部存在于 REA ${surface.version}`);

// ── 4. 核对 doctor --provider 的 id ──
console.log('\n【2】doctor provider id');
if (surface.providers.length) {
  const PROVIDER_RE = /doctor\s+--provider\s+([a-z][a-z0-9-]*)/g;
  let bad = 0;
  for (const f of files) {
    const rel = relative(ROOT, f);
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(PROVIDER_RE)) {
        const id = m[1];
        if (surface.providers.includes(id)) continue;
        if (id.startsWith('<')) continue;  // 占位符
        bad++;
        warn(`${rel}:${i + 1} 用了 --provider ${id}，但 ${surface.version} 只接受 ${surface.providers.join(' | ')}`);
      }
    });
  }
  if (!bad) ok(`文档里出现的 --provider id 都在 [${surface.providers.join(', ')}] 内`);
} else {
  info('包里没有 DOCTOR_PROVIDER_IDS，跳过');
}

// ── 5. 核对 Node 版本声明 ──
console.log('\n【3】Node 版本要求');
const nodeClaims = [];
const SELF_PATH = fileURLToPath(import.meta.url);
for (const f of files) {
  if (f === SELF_PATH) continue;   // 本脚本注释里就写着示例 engines，不能自证其罪
  const rel = relative(ROOT, f);
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    // 抓形如 ^22.19.0 || ^24.11.0 || >=26.0.0 的三段区间
    const m = /\^(\d+)\.(\d+)\.(\d+)\s*\|\|\s*\^(\d+)\.(\d+)\.(\d+)\s*\|\|\s*>=\s*(\d+)\.(\d+)\.(\d+)/.exec(line);
    if (m) nodeClaims.push({ rel, line: i + 1, text: m[0], lineText: line });
  });
}
if (surface.node) {
  let stale = 0;
  for (const c of nodeClaims) {
    if (c.text.replace(/\s+/g, '') === surface.node.replace(/\s+/g, '')) continue;
    // 判断这行的 engines 值到底属于哪个版本。
    // 形如 `6.5.0: ^22.19...` / `**6.5.0 基线**...` / `REA 6.5.0 的 package.json`
    // 都指明了"我写的是 X 的要求"。若 X === 正在验证的版本，但那串 engines 又对不上，
    // 说明标注本身就错了，要报；若 X !== 当前验证版本，这是有意的历史说明，放过。
    const m = /\b(\d+\.\d+\.\d+)\b[\s*:：]*[^\n]{0,20}(?:基线|的\s*`?package\.json`?)/.exec(c.lineText || '') ||
              /\b(\d+\.\d+\.\d+)\s*:/.exec(c.lineText || '');
    const namesBaseline = m && m[1] !== surface.version;
    if (namesBaseline) {
      info(`${c.rel}:${c.line} 写明是 ${m[1]} 的要求，跳过（正在对照 ${surface.version}）`);
      continue;
    }
    stale++;
    warn(`${c.rel}:${c.line} 写的是 ${c.text}，但 REA ${surface.version} 要求 ${surface.node}`);
  }
  if (!stale) ok(`${nodeClaims.length} 处 Node 版本声明与 ${surface.version} 一致，或已注明基线版本`);
  if (stale && nodeClaims.length) {
    info('（若手册有意以旧版本为基线，请在该处明确写出"这是 X 版要求"并给出当前值）');
  }
} else {
  info('包里没有 engines.node，跳过');
}

// ── 6. 汇总 ──
console.log(`\n${problems === 0 ? '✅ 全部对得上' : `⚠️  发现 ${problems} 处与 REA ${surface.version} 不一致`}\n`);
process.exit(problems === 0 ? 0 : 1);
