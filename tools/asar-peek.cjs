// Parse an ASAR archive header without extracting; print top-level layout and package.json.
const fs = require('fs');

const argv = process.argv.slice(2);
// --layout 是旗标，不是位置参数。原先写死 argv[4]，导致
// `asar-peek app.asar --layout` 把 --layout 当成"要读的归档内文件"，静默无输出。
const wantLayout = argv.includes("--layout");
const positional = argv.filter((a) => !a.startsWith("--"));
const path = positional[0];
const target = positional[1];
if (!path) {
  console.error('usage: node asar-peek.cjs <app.asar> [file-in-archive] [--layout]');
  process.exit(2);
}
if (!fs.existsSync(path)) { console.error('file not found: ' + path); process.exit(2); }
if (fs.statSync(path).isDirectory()) {
  console.error('this script takes an .asar file, not a directory: ' + path);
  process.exit(2);
}
const fileSize = fs.statSync(path).size;
const fd = fs.openSync(path, 'r');
const head = Buffer.alloc(16);
const headRead = fs.readSync(fd, head, 0, 16, 0);

// 三道校验。缺了它们，把任意文件当 asar 读会拿垃圾长度去 Buffer.alloc，
// 轻则 JSON 解析失败，重则直接抛 "Cannot create a string longer than 0x1fffffe8"——
// 那正是本手册警告读者的那条错误，工具自己不该制造它。
if (headRead < 16 || head.readUInt32LE(0) !== 4) {
  console.error('not an asar archive (bad header magic): ' + path);
  fs.closeSync(fd);
  process.exit(2);
}
const jsonLen = head.readUInt32LE(12);
const MAX_HEADER = 64 * 1024 * 1024;   // 真实 asar 头部 < 3 MB；防伪造巨型长度
if (jsonLen <= 0 || jsonLen > MAX_HEADER || 16 + jsonLen > fileSize) {
  console.error(`not an asar archive (header length ${jsonLen} is out of range for a ${fileSize}-byte file): ` + path);
  fs.closeSync(fd);
  process.exit(2);
}
const headerBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, headerBuf, 0, jsonLen, 16);
let header;
try {
  header = JSON.parse(headerBuf.toString('utf8'));
} catch {
  console.error('not an asar archive (header is not valid JSON): ' + path);
  fs.closeSync(fd);
  process.exit(2);
}

// Data region starts after the second pickle: 8-byte size pickle + full header pickle.
const baseOffset = 8 + head.readUInt32LE(4);
console.log('header bytes:', jsonLen, '| data starts at:', baseOffset);

// read a file out of the archive
function readFile(node, offset, parts = []) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      const r = readFile(child, offset + parseInt(child.offset || '0', 10), [...parts, name]);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (parts.join('/') === process.argv[3]) {
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, baseOffset + offset);
    return buf.toString('utf8');
  }
  return undefined;
}

const pkg = readFile(header, 0);
if (pkg && target) {
  const parsed = JSON.parse(pkg);
  console.log('===', process.argv[3], '===');
  console.log(JSON.stringify({
    name: parsed.name, version: parsed.version, main: parsed.main,
    description: parsed.description,
    dependencies: parsed.dependencies ? Object.keys(parsed.dependencies).slice(0, 40) : null,
    depCount: parsed.dependencies ? Object.keys(parsed.dependencies).length : 0,
  }, null, 2));
}

// top-level layout summary
if (wantLayout) {
  const rows = [];
  function walk(node, prefix, depth) {
    if (depth > 2) return;
    const entries = Object.entries(node.files || {});
    let files = 0, bytes = 0;
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      for (const c of Object.values(n.files || {})) {
        if (c.files) stack.push(c);
        else { files++; bytes += c.size || 0; }
      }
    }
    rows.push({ p: prefix || '.', files, mb: +(bytes / 1048576).toFixed(1) });
    for (const [name, child] of entries) {
      if (child.files) walk(child, prefix + '/' + name, depth + 1);
    }
  }
  walk(header, '', 1);
  rows.sort((a, b) => b.mb - a.mb);
  console.log('=== top dirs by size ===');
  for (const r of rows.slice(0, 25)) console.log(`${String(r.mb).padStart(8)} MB  ${String(r.files).padStart(6)} files  ${r.p}`);
}
