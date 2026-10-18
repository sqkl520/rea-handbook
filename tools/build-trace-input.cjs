// Build a trace input from saved application evidence, per the documented CLI workflow.
const fs = require('fs');

const [, , evidencePath, outPath, seedKind, seedValue] = process.argv;
if (!evidencePath) {
  console.error('usage: node build-trace-input.cjs <evidence.json> <out.json> <seedKind> <seedValue>');
  process.exit(2);
}
if (!fs.existsSync(evidencePath)) { console.error('file not found: ' + evidencePath); process.exit(2); }
const application = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
fs.writeFileSync(outPath, JSON.stringify({
  application,
  seed: { kind: seedKind, value: seedValue },
  direction: 'both',
}));
console.log('wrote', outPath, 'seed', seedKind, seedValue);
