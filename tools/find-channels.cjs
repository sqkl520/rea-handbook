// Find where IPC channel data lives in the REA application evidence.
const fs = require('fs');

if (process.argv[2] === undefined) {
  console.error('usage: node find-channels.cjs <evidence.json>');
  process.exit(2);
}
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const n = d.normalized_result;

// walk the whole tree looking for channel-bearing structures
// 深度上限防栈溢出，同时避免 path 字符串在深树上指数膨胀
const MAX_DEPTH = 300;
const hits = new Map();
function walk(o, path, depth = 0) {
  if (o === null || typeof o !== 'object') return;
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(o)) {
    o.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    if (/channel/i.test(k)) {
      const entry = hits.get(k) || { count: 0, sample: null };
      entry.count++;
      if (entry.sample === null) entry.sample = JSON.stringify(v).slice(0, 240);
      hits.set(k, entry);
    }
    walk(v, `${path}.${k}`, depth + 1);
  }
}
walk(n, 'n');

for (const [k, v] of [...hits.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
  console.log(`key=${k} count=${v.count}\n  sample: ${v.sample}\n`);
}
