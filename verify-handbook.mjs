#!/usr/bin/env node
// 手册发布前验证：链接完整性、占位符、合规扫描、结构检查。
// 用法：node verify-handbook.mjs
// 注意：合规词条以 base64 存储——这个脚本本身进公开仓库，
// 不能携带它要扫描的敏感字面值（首次发布时曾因此漏网）。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
let problems = 0;
const warn = (msg) => { console.log('  ⚠️  ' + msg); problems++; };
const ok = (msg) => console.log('  ✅ ' + msg);
const info = (msg) => console.log('  ·  ' + msg);

// ── 收集所有文本文件（md + 脚本 + 配置），只取"会进仓库"的那些 ──
// 只扫 git 跟踪 + 未被忽略的文件，而不是磁盘上的一切：
//  · 内部文件（_readme-project/、_internal/、_publish-checklist.md）被 .gitignore 挡在
//    仓库之外，扫它们没有意义，还会因为含有历史敏感词而误报。
//  · 反过来，凡是能进仓库的文件一律要扫——所以这里不能再跳过 "_" 开头的名字。
//    曾经那样跳过，配上只忽略一个下划线文件的 .gitignore，等于给 _notes.md 开了后门。
const TEXT_EXT = /\.(md|mjs|cjs|js|json|txt|yml|yaml)$/;
let gitFiles = null;
try {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  // 未跟踪但没被忽略的新文件也要扫（提交前跑一次就能拦住）
  const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  gitFiles = new Set([...tracked, ...untracked].map((f) => f.split('\\').join('/')));
} catch {
  /* 不在 git 工作区（比如从 zip 解压的副本），退回全盘遍历 */
}
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
const files = gitFiles
  ? walk(ROOT).filter((f) => gitFiles.has(relative(ROOT, f).split('\\').join('/')))
  : walk(ROOT);
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

// ── 8. 锚点核对 ──
// 【1】只验证"链接指向的文件在不在"——它用 split('#')[0] 把片段抹掉了，
// 所以页内锚点 `]( #xxx)` 和跨文件 `](a.md#xxx)` 从来没被检查过。
// 中文标题带全角标点时，GitHub 的 slug 会把标点整个删掉；改一个标题字，
// 锚点就静默 404，而"链接全绿"仍然通过。
//
// 这里按 GitHub 的 slug 规则实算，并且是**围栏感知**的：代码块里的
// `# 注释` 不是标题，用朴素正则会把它们算进 slug 集合，从而给假绿灯。
console.log('\n【8】锚点核对');

// GitHub slugify：转小写 → 去 HTML/反引号/链接语法 → 只留字母数字连字符空格 → 空格转连字符
const slugify = (t) =>
  String(t)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|\*/g, '')
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .replace(/ /g, '-');

// 收集一个文件的真实标题（跳过代码围栏内的内容）
function headingSlugs(mdPath) {
  const lines = readFileSync(mdPath, 'utf8').split('\n');
  const slugs = new Set();
  let inFence = false;
  let fenceChar = '';
  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (!h) continue;
    const base = slugify(h[1].trim());
    // 重复标题 GitHub 会加 -1 -2 后缀
    let s = base;
    let n = 0;
    while (slugs.has(s)) {
      n += 1;
      s = `${base}-${n}`;
    }
    slugs.add(s);
  }
  return slugs;
}

const slugCache = new Map();
const slugsOf = (mdPath) => {
  if (!slugCache.has(mdPath)) slugCache.set(mdPath, headingSlugs(mdPath));
  return slugCache.get(mdPath);
};

let anchorChecked = 0;
let anchorDead = 0;
let crossFileAnchors = 0;
for (const f of mdFiles) {
  const text = readFileSync(f, 'utf8');
  const dir = dirname(f);
  const rel = relative(ROOT, f);
  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const url = m[2];
    if (/^https?:|^mailto:/.test(url)) continue;
    if (!url.includes('#')) continue;

    const [pathPart, fragment] = url.split('#');
    if (!fragment) continue;
    // GitHub 的锚点是原文片段，不需要 URL 解码成别的东西；但 %20 之类要还原
    let frag = fragment;
    try {
      frag = decodeURIComponent(fragment);
    } catch {
      /* 保留原样 */
    }

    const targetPath = pathPart ? resolve(dir, pathPart) : f;
    if (!existsSync(targetPath)) {
      // 文件不存在由【1】报，这里不重复
      continue;
    }
    if (pathPart) crossFileAnchors += 1;
    anchorChecked += 1;

    const slugs = slugsOf(targetPath);
    if (!slugs.has(frag)) {
      const where = pathPart ? `${rel} → ${pathPart}#${fragment}` : `${rel} 页内 #${fragment}`;
      warn(`${where} 是死锚点（该文件的真实标题 slug：${[...slugs].slice(0, 6).join(' | ')}${slugs.size > 6 ? ' …' : ''}）`);
      anchorDead += 1;
    }
  }
}
if (anchorChecked === 0) {
  info('没有带 #片段 的链接需要核对');
} else if (anchorDead === 0) {
  ok(`${anchorChecked} 个锚点全部命中真实标题${crossFileAnchors ? `（其中 ${crossFileAnchors} 个跨文件）` : ''}`);
}

// ── 9. 自述统计 ──
// README 的「仓库结构」节把入库文件数、各目录行数写成了"跑这条命令就能得到"，
// 但那些反引号里的命令 verify 抓不到。加 evidence/ 时这几个数就漂过一次
// （case-studies 从 4 个文件变成 7 个，合计 13 → 16）。
// 这里只认 README 里形如 `| \`dir/\` | 3 | 1,043 |` 的表格行和注释里的 → N。
console.log('\n【9】README 自述统计');
{
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  // git 的 pathspec `dir/*.md` 会跨子目录命中，所以这里也要递归。
  const md = (dir) => {
    const p = join(ROOT, dir);
    if (!existsSync(p)) return null;
    return walk(p).filter((f) => f.endsWith('.md')).sort();
  };
  const lineCount = (files) => files.reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').length - 1, 0);
  const num = (s) => Number(s.replace(/,/g, ''));

  const claims = [];
  const rowRe = /^\|\s*`([a-z-]+)\/`\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|/gm;
  let totalFiles = 0;
  let totalLines = 0;
  for (const m of readme.matchAll(rowRe)) {
    const [, dir, f, l] = m;
    const list = md(dir);
    if (!list) { warn(`README 列了 ${dir}/ 的统计，但仓库里没有这个目录`); continue; }
    totalFiles += list.length;
    totalLines += lineCount(list);
    claims.push([`${dir}/ 文件数`, num(f), list.length]);
    claims.push([`${dir}/ 行数`, num(l), lineCount(list)]);
  }
  // 合计行
  const totRe = /^\|\s*合计\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|/m;
  const tot = readme.match(totRe);
  if (claims.length && tot) {
    claims.push(['合计文件数', num(tot[1]), totalFiles]);
    claims.push(['合计行数', num(tot[2]), totalLines]);
  }
  // git ls-files 那三条注释里的 → N。README 承诺的是"跑这条命令得到这个数"，
  // 所以这里就真去跑 git——从 zip 解压出来的副本没有 .git，跳过该项。
  let tracked = null;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    info('不在 git 工作区内，跳过 `git ls-files` 计数核对');
  }
  if (tracked) {
    const fnRe = /git ls-files(?: ([^\n#]+?))?\s*\|\s*wc -l\s*#\s*→\s*([\d,]+)/g;
    const match = (glob) => {
      const g = (glob || '').trim().replace(/^'|'$/g, '');
      if (!g) return tracked.length;
      if (g === '*.md') return tracked.filter((f) => f.endsWith('.md')).length;
      if (g === 'tools/*.cjs') return tracked.filter((f) => /^tools\/[^/]+\.cjs$/.test(f)).length;
      return null;
    };
    for (const m of readme.matchAll(fnRe)) {
      const [, glob, n] = m;
      const actual = match(glob);
      if (actual === null) continue;
      claims.push([`git ls-files ${(glob || '').trim()} 条数`, num(n), actual]);
    }
  }

  // ── 标签计数 ──
  // README 的「凭什么信」节有一张三档标签表，写着 by-target-type.md 里各有多少处，
  // 配了复算命令。这些数同样会随正文增删漂移（往 guides 里标一个【官方】就变），
  // 而前面那些表格行的正则抓不到它们——之前往 by-target-type.md 加了一个标签，
  // 8 变成 9，verify 依然全绿。
  const bt = join(ROOT, 'guides/by-target-type.md');
  if (existsSync(bt)) {
    const btText = readFileSync(bt, 'utf8');
    const lines = btText.split('\n');
    // 图例行里同时定义了多种标签，不能算作"使用"
    const countTag = (tag) => lines.filter((l) => l.includes(tag) && !l.includes('标注约定')).length;
    const tagTable = [
      ['【官方】', countTag('【官方】')],
      ['【实测】', countTag('【实测】')],
      ['【我们的发现】', countTag('【我们的发现】')],
    ];
    for (const [tag, actual] of tagTable) {
      // 表格行形如 `| 【官方】 | 官方文档与契约写明的 | 8 处 |`
      const re = new RegExp(`\\|\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|[^|]*\\|\\s*([\\d,]+)\\s*处\\s*\\|`);
      const m = readme.match(re);
      if (!m) continue;
      const declared = num(m[1]);
      claims.push([`${tag} 标签数`, declared, actual]);
    }
    // 复算命令里的 → N 也要对得上
    const cmdRe = /grep\s+'?(【[^】]+】)'?\s+guides\/by-target-type\.md\s*\|\s*grep\s+-vc\s+'标注约定'\s*#\s*→\s*([\d,]+)/g;
    for (const m of readme.matchAll(cmdRe)) {
      const actual = countTag(m[1]);
      claims.push([`${m[1]} 复算命令`, num(m[2]), actual]);
    }
  }

  let bad = 0;
  for (const [name, declared, actual] of claims) {
    if (declared !== actual) {
      warn(`README 自述「${name}」= ${declared}，实际 ${actual}`);
      bad++;
    }
  }
  if (!bad) ok(`${claims.length} 条 README 自述统计与实际一致`);
}

console.log(`\n${problems === 0 ? '✅ 全部通过' : `⚠️  发现 ${problems} 个问题`}\n`);
process.exit(problems === 0 ? 0 : 1);
