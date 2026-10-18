#!/usr/bin/env node
// 手册发布前验证：链接完整性、占位符、合规扫描、结构检查。
// 用法：node verify-handbook.mjs
// 注意：合规词条以 base64 存储——这个脚本本身进公开仓库，
// 不能携带它要扫描的敏感字面值（首次发布时曾因此漏网）。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
let problems = 0;
const warn = (msg) => { console.log('  ⚠️  ' + msg); problems++; };
const ok = (msg) => console.log('  ✅ ' + msg);
const info = (msg) => console.log('  ·  ' + msg);

// ── 收集所有文本文件（md + 脚本 + 配置），跳过内部文件与 .git ──
const TEXT_EXT = /\.(md|mjs|cjs|js|json|txt|yml|yaml)$/;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    if (name.startsWith('_')) continue;   // 跳过内部文件（如 _publish-checklist.md）
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name)) out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const mdFiles = files.filter((f) => f.endsWith('.md'));
console.log(`\n扫描 ${files.length} 个文本文件（其中 ${mdFiles.length} 个 Markdown）\n`);

// ── 1. 内部链接检查（仅 md）──
console.log('【1】内部链接');
let linkCount = 0;
let linkProblems = 0;
for (const f of mdFiles) {
  const text = readFileSync(f, 'utf8');
  const dir = dirname(f);
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const target = m[2];
    if (/^https?:|^mailto:|^#/.test(target)) continue;   // 外链/锚点跳过
    linkCount++;
    const clean = target.split('#')[0];
    if (!clean) continue;
    const resolved = resolve(dir, clean);
    if (!existsSync(resolved)) {
      warn(`${relative(ROOT, f)} → 断链: ${target}`);
      linkProblems++;
    }
  }
}
if (linkProblems === 0) ok(`${linkCount} 个内部链接全部有效`);

// ── 2. 合规扫描（全部文本文件，词条 base64）──
console.log('\n【2】合规扫描');
const forbidden = [
  ['5Zyf6LGG56CB', '授权机制分析'],
  ['UlVOVE1TQUFB', '密钥字面值'],
  ['ZmU3MmVkYzI=', 'OAuth ClientId'],
  ['YWkuZnVycnk=', '私有端点'],
  ['VXNlcnNcQWRtaW5pc3RyYXRvcg==', '本机用户名'],
  ['RDpcUHJvamVjdHM=', '本机路径'],
  ['RG9uYXRpb25SYW5r', '赞助档位'],
];
let found = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [b64, why] of forbidden) {
    const needle = Buffer.from(b64, 'base64').toString('utf8');
    if (text.includes(needle)) {
      warn(`${relative(ROOT, f)} 含敏感词（${why}）`);
      found++;
    }
  }
}
if (found === 0) ok('无敏感内容残留（含脚本与配置文件）');

// ── 3. 占位符检查（仅 md）──
console.log('\n【3】占位符');
const placeholders = new Map();
for (const f of mdFiles) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/<[^<>\n]{2,40}>/g)) {
    const ph = m[0];
    // 排除 HTML 标签和泛型
    if (/^<\/?[a-z][a-z0-9-]*(\s|>|\/)/i.test(ph)) continue;
    if (/^<[A-Z][A-Za-z]*(\s|>)/.test(ph) && !ph.includes('你的')) continue;
    placeholders.set(ph, (placeholders.get(ph) || 0) + 1);
  }
}
const concern = [...placeholders.entries()]
  .filter(([p]) => /你的用户名|工作区|你的项目|repo_owner/.test(p));
if (concern.length) {
  for (const [p, n] of concern) info(`占位符 ${p} ×${n}（发布前确认是否恰当）`);
} else ok('无待替换的发布相关占位符');

// ── 4. 结构检查 ──
console.log('\n【4】结构');
const required = [
  'README.md', 'LICENSE', 'NOTICE.md', '.gitignore',
  'docs/01-getting-started.md', 'docs/02-agent-integration.md',
  'guides/by-target-type.md', 'guides/troubleshooting.md',
  'case-studies/README.md', 'prompts/README.md', 'tools/README.md',
];
for (const r of required) {
  if (existsSync(join(ROOT, r))) ok(r);
  else warn(`缺失: ${r}`);
}

// ── 5. 篇幅概览（仅 md）──
console.log('\n【5】篇幅');
for (const f of [...mdFiles].sort()) {
  const n = readFileSync(f, 'utf8').split('\n').length;
  info(`${String(n).padStart(5)} 行  ${relative(ROOT, f)}`);
}

console.log(`\n${problems === 0 ? '✅ 全部通过' : `⚠️  发现 ${problems} 个问题`}\n`);
process.exit(problems === 0 ? 0 : 1);
