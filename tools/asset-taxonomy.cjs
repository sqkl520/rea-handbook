// Asset taxonomy for an ASAR archive: file-type census, biggest files, and JS chunk structure.
// Layout-agnostic — auto-discovers the JS-heavy directory, so it works on any Electron app.asar.
// Usage: node asset-taxonomy.cjs <app.asar> [jsDirOverride]
const fs = require('fs');

const asar = process.argv[2];
if (!asar) {
  console.error('usage: node asset-taxonomy.cjs <app.asar> [jsDirOverride]');
  process.exit(2);
}
if (!fs.existsSync(asar)) { console.error('file not found: ' + asar); process.exit(2); }

const { openAsar } = require('./asar-lib.cjs');
const { fd, header, baseOffset } = openAsar(asar);

// ---- flatten the header tree into a file list ----
// 深度上限防栈溢出：伪造一个几万层嵌套的 header 会让递归炸掉。
// 真实 asar 的目录层级很少超过 20 层。
const MAX_DEPTH = 200;
const files = [];
(function walk(node, prefix, depth) {
  if (depth > MAX_DEPTH) {
    console.error(`warning: 目录深度超过 ${MAX_DEPTH} 层，已停止展开 ${prefix || '/'}`);
    return;
  }
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name;
    if (child.files) walk(child, p, depth + 1);
    else files.push({ path: p, size: child.size || 0 });
  }
})(header, '', 0);

// ---- 1. Extension census ----
const byExt = {};
for (const f of files) {
  const dot = f.path.lastIndexOf('.');
  const slash = f.path.lastIndexOf('/');
  const ext = dot > slash ? f.path.slice(dot + 1).toLowerCase() : '(none)';
  byExt[ext] = (byExt[ext] || 0) + 1;
}
console.log('=== files by extension ===');
for (const [e, c] of Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(String(c).padStart(7), e);
}
console.log('total files:', files.length);

// ---- 2. Biggest files overall ----
console.log();
console.log('=== biggest files ===');
for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 15)) {
  console.log((f.size / 1048576).toFixed(2).padStart(8), 'MB', f.path);
}

// ---- 3. JS directory (auto-detect or override) ----
// Accept "/webview/assets", "webview/assets", and Git Bash MSYS rewrites ("D:/Git/webview/assets").
const normDir = (p) => {
  p = String(p).replace(/\\/g, '/');
  const msys = p.match(/^[A-Za-z]:\/(?:Git|Program Files\/Git)\/(.*)$/);
  if (msys) p = '/' + msys[1];
  return p.startsWith('/') ? p.replace(/\/$/, '') : '/' + p.replace(/\/$/, '');
};
const jsFiles = files.filter((f) => /\.(js|mjs|cjs)$/i.test(f.path));
const dirBytes = new Map();
for (const f of jsFiles) {
  const dir = f.path.replace(/\/[^/]+$/, '') || '/';
  dirBytes.set(dir, (dirBytes.get(dir) || 0) + f.size);
}
const jsDir = process.argv[3] ? normDir(process.argv[3]) :
  [...dirBytes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!jsDir) { console.log('\n(no .js files found)'); process.exit(0); }

console.log();
console.log(`=== JS chunks in ${jsDir} ===`);
const chunks = files.filter((f) => f.path.startsWith(jsDir + '/') && /\.js$/i.test(f.path));
const chunkNames = new Set(chunks.map((f) => f.path.slice(jsDir.length + 1)));
const locale = [], plain = [];
for (const f of chunks) {
  const n = f.path.slice(jsDir.length + 1);
  if (n.includes('/')) continue;                       // only top level of the dir
  // A trailing hash segment marks a build-tool chunk. Hashes vary:
  //   Vite/Rollup: mixed-case base64url (D4uiA12o, CdvdlRdl) — used by Claude, OpenCode
  //   webpack: lowercase hex (737655e1fb23) — used by older Codex builds
  const m = n.match(/-([A-Za-z0-9_-]{6,16})\.js$/);
  if (m) {
    // locale chunks look like "en-US-HASH.js" / "zh-CN-HASH.js" / "my-MM-HASH.js"
    if (/^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?-/.test(n.slice(0, m.index))) locale.push(f);
    else plain.push(f);
  } else plain.push(f);                                // unhashed entry chunks count too
}
console.log('top-level chunks:', chunkNames.size);
for (const [label, list] of [['biggest chunks', plain], ['locale-like chunks (lang-hash.js)', locale]]) {
  console.log();
  console.log(`--- ${label}: ${list.length} ---`);
  for (const f of list.sort((a, b) => b.size - a.size).slice(0, 12)) {
    console.log((f.size / 1048576).toFixed(2).padStart(8), 'MB', f.path.slice(jsDir.length + 1));
  }
}

// ---- 4. wasm / media / font assets ----
console.log();
console.log('=== wasm / media / font assets ===');
const media = files.filter((f) => /\.(wasm|mp4|webm|woff2?|ttf|otf)$/i.test(f.path));
for (const f of media.sort((a, b) => b.size - a.size).slice(0, 15)) {
  console.log((f.size / 1048576).toFixed(2).padStart(8), 'MB', f.path);
}
if (!media.length) console.log('(none)');
