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

// ── 6. 行号断言核对 ──
// 文档里写着「grep -n "X" file # → 第 N 行」这种可核对的断言。被引文件一改，行号就漂，
// 而读者是按行号去跳的。这里把每条断言实跑一遍：
//   · 模式零命中            → 那条命令对读者是空的
//   · 声称的行号不在命中里  → 读者跳到错的地方
// 同一行可能并排写两条命令，所以断言只在该命令**自己那段文本**里找
// （从这条命令的起点到下一处 `grep -n` 或行尾）。
console.log('\n【6】行号断言');
const claimRe = /grep -n "([^"]+)"\s+([A-Za-z0-9_./-]+\.md)/g;
let claimsChecked = 0;
let claimsFailed = 0;
for (const f of mdFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(claimRe)];
    for (let k = 0; k < matches.length; k++) {
      const m = matches[k];
      const [, pattern, target] = m;
      // 这条命令自己的文本片段（到下一处 grep -n 之前为止）
      const segStart = m.index;
      const segEnd = k + 1 < matches.length ? matches[k + 1].index : line.length;
      const segment = line.slice(segStart, segEnd);

      const targetPath = resolve(ROOT, target);
      if (!existsSync(targetPath)) {
        warn(`${relative(ROOT, f)}:${i + 1} 行号断言指向不存在的文件 ${target}`);
        claimsFailed++;
        continue;
      }
      const hits = readFileSync(targetPath, 'utf8')
        .split('\n')
        .map((t, n) => (t.includes(pattern) ? n + 1 : 0))
        .filter(Boolean);
      if (hits.length === 0) {
        warn(`${relative(ROOT, f)}:${i + 1} 模式 ${JSON.stringify(pattern)} 在 ${target} 里零命中——给读者的这条命令是空的`);
        claimsFailed++;
        continue;
      }

      // 断言解析：区间（A-B 行）表示"内容横跨这段"，只要求端点落在命中范围附近；
      // 「A 与 B 行」「第 N 行」要求确实命中。
      const claims = [];      // { nums: [...], kind: 'span' | 'exact' }
      let rest = segment;
      for (const c of [...rest.matchAll(/(\d+)\s*[-–]\s*(\d+)\s*行/g)]) {
        claims.push({ nums: [+c[1], +c[2]], kind: 'span' });
        rest = rest.replace(c[0], ' ');
      }
      for (const c of [...rest.matchAll(/(\d+)\s*与\s*(\d+)\s*行/g)]) {
        claims.push({ nums: [+c[1], +c[2]], kind: 'exact' });
        rest = rest.replace(c[0], ' ');
      }
      for (const c of rest.matchAll(/第\s*(\d+)\s*行/g)) {
        claims.push({ nums: [+c[1]], kind: 'exact' });
      }
      if (claims.length === 0) continue;   // 没写行号，只做了"命令非空"这一层

      claimsChecked++;
      for (const cl of claims) {
        const bad = cl.nums.filter((n) => !hits.includes(n));
        if (bad.length === 0) continue;
        if (cl.kind === 'span') {
          // 区间断言：只要有命中落在 [lo, hi] 内即可（表格/多行段落常横跨几行）
          const [lo, hi] = cl.nums;
          const inside = hits.some((h) => h >= lo && h <= hi);
          if (inside) continue;
        }
        warn(
          `${relative(ROOT, f)}:${i + 1} 声称 ${bad.join('/')} 行，实测命中 ${hits.join(',')}（模式 ${JSON.stringify(pattern)}，目标 ${target}）`
        );
        claimsFailed++;
        break;
      }
    }
  }
}
if (claimsFailed === 0) {
  ok(`${claimsChecked} 条行号断言全部命中（另有无行号的 grep 命令已核对非空）`);
}

// ── 7. 一手证据核对 ──
// case-studies/evidence/ 里的摘要文件是案例数字的原始出处。文档改了数字，
// 或者证据被重新生成过，两边就会不一致。这里逐条比对：文档里写的每个
// "某数字"必须能在证据文件里找到同值。
console.log('\n【7】一手证据');
const EVIDENCE = join(ROOT, 'case-studies/evidence');
// 每条：[文档里的字面量, 证据文件, 从证据里取值的路径, 说明]
const EVIDENCE_CLAIMS = [
  ['27,278', 'trace-summary.json', (d) => d.summary.traced_nodes, 'traced_nodes'],
  ['32,977', 'trace-summary.json', (d) => d.summary.traced_edges, 'traced_edges'],
  ['7,823', 'trace-summary.json', (d) => d.summary.terminal_paths, 'terminal_paths'],
];
let evidenceChecked = 0;
let evidenceFailed = 0;
if (!existsSync(EVIDENCE)) {
  warn('缺少 case-studies/evidence/ —— 案例数字将没有原始出处可核对');
} else {
  for (const [literal, file, get, label] of EVIDENCE_CLAIMS) {
    const p = join(EVIDENCE, file);
    if (!existsSync(p)) {
      warn(`证据文件缺失: case-studies/evidence/${file}`);
      evidenceFailed++;
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      warn(`证据文件不是合法 JSON: ${file}`);
      evidenceFailed++;
      continue;
    }
    const actual = get(data);
    evidenceChecked++;
    if (actual === undefined) {
      warn(`${file} 里取不到 ${label}`);
      evidenceFailed++;
      continue;
    }
    // 文档里带千分位逗号，证据里是数字：比对数值
    const declared = Number(literal.replace(/,/g, ''));
    if (declared !== actual) {
      warn(`${label} 不一致：文档写 ${literal}，证据里是 ${actual}`);
      evidenceFailed++;
    }
  }
  // 证据在文档里被引用过吗（防止文件放进来了却没人链）
  const caseMd = readFileSync(join(ROOT, 'case-studies/README.md'), 'utf8');
  const linked = /evidence\//.test(caseMd);
  if (evidenceChecked > 0 && evidenceFailed === 0) {
    ok(`${evidenceChecked} 条案例数字与证据文件一致${linked ? '' : '（注意：case-studies/README 未链接到 evidence/）'}`);
  }
  if (!linked) info('case-studies/README.md 里没有指向 evidence/ 的链接');
}

console.log(`\n${problems === 0 ? '✅ 全部通过' : `⚠️  发现 ${problems} 个问题`}\n`);
process.exit(problems === 0 ? 0 : 1);
