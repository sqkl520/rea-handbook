// Extract readable UTF-16LE strings from a .NET assembly's #US stream and elsewhere.
// .NET stores all ldstr literals as UTF-16LE in #US, so this recovers Chinese UI text and URLs.
// Usage: node us-strings.cjs <exe> <outTxt> [minLen]
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node us-strings.cjs <assembly> [out.txt] [minLen]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error('file not found: ' + file); process.exit(2); }
const outTxt = process.argv[3];
const minLen = parseInt(process.argv[4] || '4', 10);
const buf = fs.readFileSync(file);

// Find UTF-16LE runs: a run of (printable ASCII or CJK) chars where every other byte is 0x00 for ASCII,
// or a valid surrogate/CJK pair pattern. Heuristic: scan for sequences where high bytes are mostly 0.
const found = [];
let start = -1;
let run = [];
const isWidePrintable = (lo, hi) => {
  if (hi === 0) return lo >= 0x20 && lo < 0x7f;          // ASCII
  if ((hi === 0x20 || hi === 0x4e || hi === 0x4f || hi === 0x30 || hi === 0x5b || hi === 0x8b || hi === 0x9f || hi === 0xff || (hi >= 0x4e && hi <= 0x9f))) return true;
  return false;
};
// simpler & more robust: decode the whole file as utf16le, then split on junk
const total = buf.length;
const step = 1;
// scan at both alignments
for (const align of [0, 1]) {
  const parts = [];
  let curStart = 0;
  for (let i = align; i + 1 < total; i += 2) {
    const lo = buf[i], hi = buf[i + 1];
    let ok = false;
    let ch = '';
    if (hi === 0 && lo >= 0x20 && lo < 0x7f) { ok = true; ch = String.fromCharCode(lo); }
    else if (hi >= 0x00 && hi <= 0xff) {
      const cp = lo | (hi << 8);
      // CJK, fullwidth forms, common symbols
      if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xff00 && cp <= 0xffef) ||
          (cp >= 0x2000 && cp <= 0x206f) || cp === 0xfeff || (cp >= 0x2100 && cp <= 0x214f) ||
          (cp >= 0x2460 && cp <= 0x24ff) || (cp >= 0x25a0 && cp <= 0x25ff) ||
          (cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x0080 && cp <= 0x00ff)) {
        ok = true; ch = String.fromCharCode(cp);
      }
    }
    if (ok) {
      if (parts.length === 0) curStart = i;
      // 用数组累积再 join：逐字符 cur += ch 会让每个字符都触发一次字符串分配，
      // 100 MB 输入实测 RSS 2.87 GB、耗时 30 秒。数组累积降到几十 MB 量级。
      parts.push(ch);
    } else {
      if (parts.length >= minLen) {
        const s = parts.join('');
        if (s.length >= minLen) found.push({ off: curStart, s });
      }
      parts.length = 0;
    }
  }
  if (parts.length >= minLen) {
    const s = parts.join('');
    if (s.length >= minLen) found.push({ off: curStart, s });
  }
  parts.length = 0;
}

// dedupe by string content, keep shortest offsets
const seen = new Set();
const uniq = [];
for (const f of found) {
  if (seen.has(f.s)) continue;
  seen.add(f.s);
  uniq.push(f);
}
console.log('utf16 runs found:', uniq.length);

// classify
const urls = uniq.filter((f) => /^https?:\/\/|^[a-z]+:\/\//i.test(f.s));
const cjk = uniq.filter((f) => /[一-鿿]/.test(f.s));
const ascii = uniq.filter((f) => !/[一-鿿]/.test(f.s) && !/^https?:/.test(f.s));

console.log('urls:', urls.length, '| cjk:', cjk.length, '| other ascii:', ascii.length);

if (outTxt) {
  fs.writeFileSync(outTxt, [
    '# URLS', ...urls.map((f) => `${f.off}\t${f.s}`),
    '',
    '# CJK', ...cjk.map((f) => `${f.off}\t${f.s}`),
    '',
    '# ASCII', ...ascii.map((f) => `${f.off}\t${f.s}`),
  ].join('\n'));
  console.log('written', outTxt);
}

console.log();
console.log('=== URL sample ===');
for (const u of urls.slice(0, 60)) console.log(' ', u.s);
