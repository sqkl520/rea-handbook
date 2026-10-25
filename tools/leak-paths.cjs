// Extract leaked source-file paths from a compiled binary — .NET stores CallerFilePath /
// compiler paths as UTF-16LE, so the source tree shape can be reconstructed from the bytes.
// Generic: auto-detects any absolute drive/posix path ending in a source extension.
// Usage: node leak-paths.cjs <binary> [rootFilter]
//   rootFilter — optional substring to trim from output and count only paths under it
//                (e.g. "Projects\\MyApp" to only list your project's own files).
const fs = require('fs');

const file = process.argv[2];
if (file === undefined) {
  console.error('usage: node leak-paths.cjs <binary> [rootFilter]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error('file not found: ' + file); process.exit(2); }
const rootFilter = process.argv[3] || null;

const buf = fs.readFileSync(file);
const text = buf.toString('utf16le');

// Absolute paths: a Windows drive root or a POSIX root, ending in a source extension.
// Exclude control chars (binary noise) and characters that can't appear in paths.
const re = /(?:[A-Za-z]:\\|\/(?!\/))[^\u0000-\u001f:"',;{}|*?<>]{3,180}?\.(?:cs|vb|xaml(?:\.vb)?|fs|rs|go|c|cc|cpp|cxx|h|hpp|java|kt|kts|py|ts|tsx|js|jsx|mjs|swift|m|mm|php|rb|scala|dart)/g;
const found = new Set();
for (const m of text.matchAll(re)) found.add(m[0]);

const segs = (p) => p.split(/[\\/]/).filter(Boolean).length;
const base = [...found].filter((p) => segs(p) >= 2);
const all = base.filter((p) => !rootFilter || p.includes(rootFilter));
// escapeRe 之前只被调用、从未定义：带 rootFilter 跑会在第一次 trim 时 ReferenceError。
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trim = (p) => (rootFilter ? p.replace(new RegExp('^.*?' + escapeRe(rootFilter)), '') : p);

console.log('leaked source paths:', all.length, rootFilter ? `(filtered by "${rootFilter}"; ${base.length} total)` : '');

const dirs = new Map();
for (const p of all) {
  const d = p.replace(/[\\/][^\\/]+$/, '');
  dirs.set(d, (dirs.get(d) || 0) + 1);
}
console.log();
console.log('=== directories ===');
for (const [d, c] of [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(String(c).padStart(4), trim(d));
}

console.log();
console.log('=== files (first 200) ===');
for (const p of [...all].sort().slice(0, 200)) console.log(trim(p));
