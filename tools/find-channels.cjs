// Find where IPC channel data lives in the REA application evidence.
const fs = require('fs');

if (process.argv[2] === undefined) {
  console.error('usage: node find-channels.cjs <evidence.json>');
  process.exit(2);
}
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const n = d.normalized_result;

// walk the whole tree looking for channel-bearing structures
const hits = new Map();
function walk(o, path) {
  if (o === null || typeof o !== 'object') return;
  if (Array.isArray(o)) {
    o.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    if (/channel/i.test(k)) {
      const entry = hits.get(k) || { count: 0, sample: null };
      entry.count++;
      if (entry.sample === null) entry.sample = JSON.stringify(v).slice(0, 240);
      hits.set(k, entry);
    }
    walk(v, `${path}.${k}`);
  }
}
walk(n, 'n');

for (const [k, v] of [...hits.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
  console.log(`key=${k} count=${v.count}\n  sample: ${v.sample}\n`);
}
