// Deep CSS analysis of a stylesheet inside an ASAR: framework fingerprint, modern CSS features,
// component-module inventory, and token architecture.
// Usage: node css-deep.cjs <app.asar> <path-of-css-in-archive>
const fs = require('fs');

const asar = process.argv[2];
if (!asar) {
  console.error('usage: node css-deep.cjs <app.asar> <path-in-archive>...');
  process.exit(2);
}
if (!fs.existsSync(asar)) { console.error('file not found: ' + asar); process.exit(2); }
const targets = process.argv.slice(3);

const fd = fs.openSync(asar, 'r');
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
  return buf.toString('utf8');
}
function getFile(target) {
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

const css = getFile(targets[0]);
if (!css) { console.log('css not found'); process.exit(1); }
console.log('stylesheet bytes:', css.length);
console.log();

const count = (needle) => css.split(needle).length - 1;

console.log('=== CSS framework fingerprints ===');
const fingerprints = [
  '@layer theme', '@layer base', '@layer components', '@layer utilities',
  'tailwind', '--tw-', '@property --tw', 'rgba(0,0,0,0)',
];
for (const p of fingerprints) console.log(String(count(p)).padStart(7), p);

console.log();
console.log('=== modern CSS feature usage ===');
const modern = ['oklch(', 'color-mix(', 'light-dark(', 'color(', 'rgb(', 'hsl(', '@supports', '@property', 'view-transition', '::backdrop', 'scroll-timeline', ':has(', '@starting-style', 'anchor('];
for (const p of modern) console.log(String(count(p)).padStart(7), p);

console.log();
console.log('=== CSS modules (hashed class names) ===');
const modules = new Set();
// CSS module hashes look like ._Name_hash_1 or ._Name_hash_2
for (const m of css.matchAll(/\._([A-Za-z][A-Za-z0-9]*)_([a-z0-9]{5})_\d+/g)) modules.add(m[1]);
console.log('distinct component classes:', modules.size);
console.log([...modules].slice(0, 80).join(', '));

console.log();
console.log('=== @property registered custom properties ===');
const props = new Set();
for (const m of css.matchAll(/@property\s+(--[a-zA-Z0-9-]+)/g)) props.add(m[1]);
console.log('registered:', props.size);
console.log([...props].join(', '));

console.log();
console.log('=== token layers ===');
const tokenPrefixes = {};
for (const m of css.matchAll(/--([a-z0-9]+(?:-[a-z0-9]+)?)/g)) {
  const key = m[1].split('-')[0];
  tokenPrefixes[key] = (tokenPrefixes[key] || 0) + 1;
}
const sorted = Object.entries(tokenPrefixes).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [k, v] of sorted) console.log(String(v).padStart(7), '--' + k + '-*');

console.log();
console.log('=== animation / transition vocabulary ===');
const anims = new Set();
for (const m of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) anims.add(m[1]);
console.log('keyframes:', anims.size);
console.log([...anims].slice(0, 50).join(', '));

console.log();
console.log('=== transition-duration tokens ===');
const durations = new Set();
for (const m of css.matchAll(/--transition-duration-[a-z0-9-]+:[^;}]{0,40}/g)) durations.add(m[0]);
console.log([...durations].join('\n'));
