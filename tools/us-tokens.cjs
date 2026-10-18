// Resolve a list of #US tokens against a heap dump produced by us-resolve.cjs --dump,
// with fuzzy offset matching (tokens sometimes point 1-2 bytes off the entry start).
// Usage: node us-tokens.cjs <us-heap.txt> <token...>           tokens as hex, e.g. 0x700145e0
//        node us-tokens.cjs <us-heap.txt> --file <tokens.txt>  read tokens from a file (any 0xXXXXXXXX occurrences)
const fs = require('fs');

const heapPath = process.argv[2];
if (!heapPath || heapPath.startsWith('--')) {
  console.error('usage: node us-tokens.cjs <us-heap.txt> <token...>');
  console.error('       node us-tokens.cjs <us-heap.txt> --file <tokens.txt>');
  process.exit(2);
}
if (!fs.existsSync(heapPath)) { console.error('file not found: ' + heapPath); process.exit(2); }

const heapLines = fs.readFileSync(heapPath, 'utf8').split('\n');
const byOff = new Map();
for (const l of heapLines) {
  const i = l.indexOf('\t');
  if (i < 0) continue;
  byOff.set(parseInt(l.slice(0, i), 10), l.slice(i + 1));
}
const look = (rid) => {
  for (const c of [rid - 1, rid, rid + 1, rid - 2]) if (byOff.has(c)) return byOff.get(c);
  // fall back: nearest entry at or below
  let best = null;
  for (const [o, t] of byOff) if (o <= rid && (best === null || o > best)) best = o;
  return best === null ? null : byOff.get(best);
};

const args = process.argv.slice(3);
let tokens;
if (args[0] === '--file') {
  if (!args[1]) { console.error('missing tokens file after --file'); process.exit(2); }
  const raw = fs.readFileSync(args[1], 'utf8');
  tokens = [...raw.matchAll(/0x([0-9a-fA-F]{8})/g)].map((m) => parseInt(m[1], 16));
} else {
  tokens = args.join(' ').split(/[\s,]+/).filter(Boolean).map((t) => parseInt(t, 16));
}
if (!tokens.length) { console.error('no tokens given'); process.exit(2); }

const seen = new Set();
for (const t of tokens) {
  const rid = t & 0xffffff;
  const s = look(rid);
  if (s === null || s === '') continue;
  if (seen.has(s)) continue;
  seen.add(s);
  console.log(s);
}
console.error(`[resolved ${seen.size} unique strings from ${tokens.length} tokens]`);
