// Extract named files from an ASAR by exact path (supports multiple paths).
const fs = require('fs');

const asarPath = process.argv[2];
if (!asarPath) {
  console.error('usage: node asar-get.cjs <app.asar> <path-in-archive>... | --dir:<dir>');
  process.exit(2);
}
if (!fs.existsSync(asarPath)) { console.error('file not found: ' + asarPath); process.exit(2); }
const targets = process.argv.slice(3);

const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const hb = Buffer.alloc(jsonLen);
fs.readSync(fd, hb, 0, jsonLen, 16);
const header = JSON.parse(hb.toString('utf8'));
const base = 8 + head.readUInt32LE(4);

function readNode(node, offset) {
  const buf = Buffer.alloc(node.size);
  fs.readSync(fd, buf, 0, node.size, base + offset);
  return buf;
}

// Normalize archive paths: accept both "package.json" and "/package.json",
// and survive Git Bash MSYS path rewriting (e.g. "/package.json" → "D:/Git/package.json").
const norm = (p) => {
  p = String(p).replace(/\\/g, '/');
  const gitBash = p.match(/^[A-Za-z]:\/(?:Git|Program Files\/Git)\/(.*)$/);
  if (gitBash) p = '/' + gitBash[1];
  return p.startsWith('/') ? p : '/' + p;
};

function getFile(target) {
  target = norm(target);
  function walk(node, prefix, off) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix + '/' + name;
      if (child.files) {
        const r = walk(child, p, off + parseInt(child.offset || '0', 10));
        if (r !== null) return r;
      } else if (p === target) {
        return readNode(child, off + parseInt(child.offset || '0', 10));
      }
    }
    return null;
  }
  return walk(header, '', 0);
}

function listDir(dirPath, depth = 1) {
  // the walk() root prefix is '' — normalize both "/" and "D:/Git/"-style rewrites to it
  if (dirPath === '/') dirPath = '';
  else { dirPath = norm(dirPath); if (dirPath === '/') dirPath = ''; }
  function walk(node, prefix, off, d) {
    if (prefix === dirPath) {
      const rows = [];
      for (const [name, child] of Object.entries(node.files || {})) {
        rows.push({ name, dir: !!child.files, size: child.size || 0, entries: child.files ? Object.keys(child.files).length : 0 });
      }
      return rows;
    }
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix + '/' + name;
      if (child.files && (dirPath === p || dirPath.startsWith(p + '/'))) {
        return walk(child, p, off + parseInt(child.offset || '0', 10), d);
      }
    }
    return null;
  }
  return walk(header, '', 0, depth);
}

for (const t of targets) {
  if (t.startsWith('--dir:')) {
    const dir = t.slice(6);
    const rows = listDir(dir);
    console.log(`=== dir ${dir} ===`);
    if (rows) for (const r of rows) console.log(r.dir ? `DIR  ${r.name}/ (${r.entries})` : `     ${r.name} ${r.size}`);
    else console.log('(not found)');
  } else if (t.startsWith('--head:')) {
    const [p, nStr] = t.slice(7).split('|');
    const buf = getFile(p);
    console.log(`=== file ${p} (first ${nStr} bytes) ===`);
    console.log(buf ? buf.toString('utf8').slice(0, parseInt(nStr, 10)) : '(not found)');
  } else {
    const buf = getFile(t);
    console.log(`=== file ${t} (${buf ? buf.length : 0} bytes) ===`);
    if (buf) process.stdout.write(buf.toString('utf8').slice(0, 4000) + '\n');
  }
}
