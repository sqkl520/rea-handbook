// Probe an ASAR archive's JS bundles for framework / library fingerprints.
// Layout-agnostic — auto-discovers the JS directory and any app-main-style bundle,
// so it works on any Electron app.asar.
// Usage: node js-stack.cjs <app.asar> [jsDirOverride]
const fs = require('fs');

const asar = process.argv[2];
if (!asar) {
  console.error('usage: node js-stack.cjs <app.asar> [jsDirOverride]');
  process.exit(2);
}
if (!fs.existsSync(asar)) { console.error('file not found: ' + asar); process.exit(2); }
// 只吃 .asar 文件。传目录/其他文件时直接读会抛 EISDIR 或 JSON 解析错误，
// 换成一句能看懂的话。
if (fs.statSync(asar).isDirectory()) {
  console.error('this script takes an .asar file, not a directory: ' + asar);
  console.error('（要分析解包后的目录，用 asset-taxonomy.cjs 或 css-deep.cjs）');
  process.exit(2);
}
{
  const fd0 = fs.openSync(asar, 'r');
  const h = Buffer.alloc(16);
  const n = fs.readSync(fd0, h, 0, 16, 0);
  fs.closeSync(fd0);
  // asar 头部：u32@0 是长度标记，u32@4 是 JSON 头长度；不对就不是 asar
  if (n < 16 || h.readUInt32LE(0) !== 4) {
    console.error('not an asar archive (bad header magic): ' + asar);
    process.exit(2);
  }
}

const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const hb = Buffer.alloc(jsonLen);
fs.readSync(fd, hb, 0, jsonLen, 16);
const header = JSON.parse(hb.toString('utf8'));
const base = 8 + head.readUInt32LE(4);

const files = [];
(function walk(node, prefix, off) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name;
    if (child.files) walk(child, p, off + parseInt(child.offset || '0', 10));
    else files.push({ path: p, size: child.size || 0, offset: off + parseInt(child.offset || '0', 10) });
  }
})(header, '', 0);

function readFile(f) {
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, base + f.offset);
  return buf.toString('utf8');
}

// ---- pick bundles: the N biggest top-level .js files ----
const jsFiles = files.filter((f) => /\.js$/i.test(f.path));
const dirBytes = new Map();
for (const f of jsFiles) {
  const dir = f.path.replace(/\/[^/]+$/, '') || '/';
  dirBytes.set(dir, (dirBytes.get(dir) || 0) + f.size);
}
// Accept "/webview/assets", "webview/assets", and Git Bash MSYS rewrites ("D:/Git/webview/assets").
const normDir = (p) => {
  p = String(p).replace(/\\/g, '/');
  const msys = p.match(/^[A-Za-z]:\/(?:Git|Program Files\/Git)\/(.*)$/);
  if (msys) p = '/' + msys[1];
  return p.startsWith('/') ? p.replace(/\/$/, '') : '/' + p.replace(/\/$/, '');
};
const jsDir = process.argv[3] ? normDir(process.argv[3]) :
  [...dirBytes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!jsDir) { console.log('(no .js files found)'); process.exit(0); }

const base_ = jsDir + '/';
const topLevel = jsFiles.filter((f) => f.path.startsWith(base_) && !f.path.slice(base_.length).includes('/'));
const bundles = topLevel.sort((a, b) => b.size - a.size).slice(0, 3);
if (!bundles.length) { console.log('(no top-level .js in ' + jsDir + ')'); process.exit(0); }

// Each probe needs enough context to avoid false positives from minified text
// ("react" appears in e.g. "reactive" — require a framework-distinctive token).
const probes = [
  ['react', /react\.production\.min|react-dom|ReactCurrentOwner|__REACT_DEVTOOLS/],
  ['React.createElement', /React\.createElement|_jsx|\bjsxs?\b/],
  ['jsx-runtime', /jsx-runtime|jsxs\(/],
  ['useState', /\buseState\b/],
  ['useEffect', /\buseEffect\b/],
  ['createContext', /createContext/],
  ['framer-motion', /framer-motion|\bmotion\.\w/],
  // Radix UI 的独有标识（小写 radix 会命中 parseInt(str, radix) 的参数名）
  ['radix', /RadixPrimitive|@radix-ui|radix-u?i\\?\/react/i],
  ['zustand', /zustand/],
  ['tanstack query', /tanstack\/query|queryCore/],
  ['xstate', /xstate/],
  ['emotion', /@emotion|emotion-styled/],
  ['styled-components', /styled-components/],
  ['vue', /vue\.runtime|createApp\(|\bVue\b/],
  ['svelte', /svelte\/internal|__svelte|svelte\.js/],
  ['angular', /angular\.module|@angular\/|ngDevMode/],
  ['solid-js', /solid-js|createSignal/],
  ['jquery', /jquery\.min|jQuery\.fn|\$\.fn\./],
  ['lit', /lit-element|lit-html|render\(html`/],
  ['preact', /preact/],
];

for (const b of bundles) {
  const js = readFile(b);
  console.log(`=== ${b.path} (${(Buffer.byteLength(js) / 1048576).toFixed(1)} MB) ===`);
  const active = [];
  for (const [name, re] of probes) {
    const m = js.match(new RegExp(re.source, 'g'));
    if (m) active.push(`${name}×${m.length}`);
  }
  console.log('   detected:', active.length ? active.join(', ') : '(no framework markers)');
  console.log('   (counts shown — high counts = embedded library, low = incidental mention)');

  // container-query tailwind classes (@container/xxx:) — a "modern CSS posture" signal
  const cq = new Set();
  for (const m of js.matchAll(/@container\\?\/[a-zA-Z0-9_-]+/g)) cq.add(m[0].replace(/\\/g, ''));
  console.log('   container-query class prefixes found:', cq.size);
  if (cq.size) console.log('   ', [...cq].slice(0, 30).join(', '));

  // CSS var references in JS
  const vars = new Set();
  for (const m of js.matchAll(/var\(--[a-zA-Z0-9-]+\)/g)) vars.add(m[0]);
  console.log('   CSS var references in JS:', vars.size);

  // cva/clsx/twMerge-style class composition
  console.log('   cva/clsx/twMerge:', /cva\(|clsx|twMerge|class-variance-authority/.test(js) ? 'YES' : ' -');
  console.log();
}
