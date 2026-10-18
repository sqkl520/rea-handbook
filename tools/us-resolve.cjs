// Resolve #US (user string) heap tokens like 0x70xxxxxx to their UTF-16 text.
// Usage: node us-resolve.cjs <exe> --dump [out.txt]   (dump whole #US heap)
//        node us-resolve.cjs <exe> <tokens...>        (tokens as hex, e.g. 0x700145e0)
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node us-resolve.cjs <assembly> [--dump] [token...]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error('file not found: ' + file); process.exit(2); }
const buf = fs.readFileSync(file);

const peOff = buf.readUInt32LE(0x3c);
const coff = peOff + 4;
const optSize = buf.readUInt16LE(coff + 16);
const opt = coff + 20;
const isPE32Plus = buf.readUInt16LE(opt) === 0x20b;
const numSections = buf.readUInt16LE(coff + 2);
const secBase = opt + optSize;
const sections = [];
for (let i = 0; i < numSections; i++) {
  const s = secBase + i * 40;
  sections.push({
    vsize: buf.readUInt32LE(s + 8), vaddr: buf.readUInt32LE(s + 12),
    rawSize: buf.readUInt32LE(s + 16), rawPtr: buf.readUInt32LE(s + 20),
  });
}
const rvaToOff = (rva) => {
  for (const s of sections) {
    if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize)) return s.rawPtr + (rva - s.vaddr);
  }
  return null;
};
const clrDir = opt + (isPE32Plus ? 112 : 96) + 14 * 8;
const clrOff = rvaToOff(buf.readUInt32LE(clrDir));
const metaOff = rvaToOff(buf.readUInt32LE(clrOff + 8));

const verLen = buf.readUInt32LE(metaOff + 12);
let p = metaOff + 16 + ((verLen + 3) & ~3);
const sc = buf.readUInt16LE(p + 2);
p += 4;
let us = null, strings = null;
for (let i = 0; i < sc; i++) {
  const off = buf.readUInt32LE(p);
  const size = buf.readUInt32LE(p + 4);
  let q = p + 8;
  let nm = '';
  while (buf[q]) nm += String.fromCharCode(buf[q++]);
  p = (q + 1 + 3) & ~3;
  if (nm === '#US') us = { off: metaOff + off, size };
  if (nm === '#Strings') strings = { off: metaOff + off, size };
}
if (!us) throw new Error('no #US heap');

// #US entries: [compressed-length][UTF-16LE bytes][optional trailing flag byte]
// The compressed length is a 7-bit-encoded value; the length includes a trailing byte when odd/even rules apply.
// The RID-based token 0x70xxxxxx means offset = (token & 0xffffff) - 1 within the heap.
function readCompressed(off) {
  const b0 = buf[off];
  if ((b0 & 0x80) === 0) return { value: b0, size: 1 };
  if ((b0 & 0xc0) === 0x80) return { value: ((b0 & 0x3f) << 8) | buf[off + 1], size: 2 };
  return { value: ((b0 & 0x1f) << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3], size: 4 };
}
function usAt(offsetInHeap) {
  let o = us.off + offsetInHeap;
  const { value: len, size } = readCompressed(o);
  o += size;
  // len is in bytes; the final byte is a flag if len is odd (UTF-16 has 2-byte units)
  let n = len & 1 ? len - 1 : len;
  const text = buf.toString('utf16le', o, o + n);
  return text;
}
function tokenToStr(token) {
  const offset = (token & 0xffffff) - 1;
  return usAt(offset);
}

const args = process.argv.slice(3);
if (args[0] === '--dump') {
  let o = 1; // heap starts with a 0 byte
  let count = 0;
  const out = [];
  while (o < us.size) {
    const start = o;
    let len, size;
    try { const r = readCompressed(us.off + o); len = r.value; size = r.size; } catch { break; }
    if (len === 0) { o++; continue; }
    o += size;
    let n = len & 1 ? len - 1 : len;
    if (o + n > us.size) break;
    const text = buf.toString('utf16le', us.off + o, us.off + o + n);
    out.push(`${start}\t${text}`);
    o += len;
    count++;
    if (count > 200000) break;
  }
  console.log('entries:', count, '| heap size:', us.size);
  const outPath = process.argv[4] || 'us-heap.txt';
  fs.writeFileSync(outPath, out.join('\n'));
  console.log('written', outPath);
} else {
  for (const t of args) {
    const tok = parseInt(t, 16);
    const s = tokenToStr(tok);
    console.log(`${t}  ${s.slice(0, 200)}`);
  }
}
